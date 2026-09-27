package calendar

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	pathpkg "path"
	"strconv"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
)

var ErrConflict = errors.New("calendar object changed remotely")

type Provider interface {
	Discover(context.Context, string) (Discovery, error)
	List(context.Context, string) ([]RemoteObject, error)
	Put(context.Context, string, string, string) (RemoteObject, error)
	Delete(context.Context, string, string) error
}

type CalDAVProvider struct {
	endpoint   *url.URL
	httpClient webdav.HTTPClient
	client     *caldav.Client
}

func NewCalDAVProvider(cfg Config) (*CalDAVProvider, error) {
	endpoint, err := url.Parse(cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse CalDAV endpoint: %w", err)
	}
	baseClient := &http.Client{Timeout: 30 * time.Second}
	authenticated := webdav.HTTPClientWithBasicAuth(baseClient, cfg.Username, cfg.Password)
	client, err := caldav.NewClient(authenticated, cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("create CalDAV client: %w", err)
	}
	return &CalDAVProvider{endpoint: endpoint, httpClient: authenticated, client: client}, nil
}

func (provider *CalDAVProvider) Discover(ctx context.Context, calendarName string) (Discovery, error) {
	principal, err := provider.client.FindCurrentUserPrincipal(ctx)
	if err != nil {
		return Discovery{}, fmt.Errorf("find CalDAV principal: %w", err)
	}
	homeSet, err := provider.client.FindCalendarHomeSet(ctx, principal)
	if err != nil {
		return Discovery{}, fmt.Errorf("find CalDAV home set: %w", err)
	}
	calendars, err := provider.client.FindCalendars(ctx, homeSet)
	if err != nil {
		return Discovery{}, fmt.Errorf("list CalDAV calendars: %w", err)
	}
	selected, found := selectCalendar(calendars, calendarName)
	if !found {
		if err := provider.createCalendar(ctx, homeSet, calendarName); err != nil {
			return Discovery{}, err
		}
		calendars, err = provider.client.FindCalendars(ctx, homeSet)
		if err != nil {
			return Discovery{}, fmt.Errorf("list CalDAV calendars after create: %w", err)
		}
		selected, found = selectCalendar(calendars, calendarName)
		if !found {
			return Discovery{}, fmt.Errorf("created CalDAV calendar %q was not returned by discovery", calendarName)
		}
	}
	return Discovery{
		PrincipalPath: principal,
		HomeSetPath:   homeSet,
		Selected:      calendarChoice(selected),
		Calendars:     calendarChoices(calendars),
	}, nil
}

func (provider *CalDAVProvider) List(ctx context.Context, calendarPath string) ([]RemoteObject, error) {
	objects, err := provider.client.QueryCalendar(ctx, calendarPath, &caldav.CalendarQuery{
		CompRequest: caldav.CalendarCompRequest{Name: ical.CompCalendar, AllProps: true, AllComps: true},
		CompFilter: caldav.CompFilter{
			Name:  ical.CompCalendar,
			Comps: []caldav.CompFilter{{Name: ical.CompEvent}},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("query CalDAV calendar: %w", err)
	}
	remote := make([]RemoteObject, 0, len(objects))
	for _, object := range objects {
		payload, err := encodeCalendar(object.Data)
		if err != nil {
			return nil, fmt.Errorf("encode CalDAV object %q: %w", object.Path, err)
		}
		_, uid, err := caldav.ValidateCalendarObject(object.Data)
		if err != nil {
			return nil, fmt.Errorf("validate CalDAV object %q: %w", object.Path, err)
		}
		remote = append(remote, RemoteObject{
			Path:        object.Path,
			ETag:        object.ETag,
			UID:         uid,
			Payload:     payload,
			PayloadHash: hashText(payload),
		})
	}
	return remote, nil
}

func (provider *CalDAVProvider) Put(ctx context.Context, objectPath, payload, etag string) (RemoteObject, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, provider.resolve(objectPath), strings.NewReader(payload))
	if err != nil {
		return RemoteObject{}, fmt.Errorf("build CalDAV PUT: %w", err)
	}
	request.Header.Set("Content-Type", "text/calendar; charset=utf-8")
	if etag == "" {
		request.Header.Set("If-None-Match", "*")
	} else {
		request.Header.Set("If-Match", etagHeader(etag))
	}
	response, err := provider.httpClient.Do(request)
	if err != nil {
		return RemoteObject{}, fmt.Errorf("put CalDAV object: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusPreconditionFailed {
		return RemoteObject{}, ErrConflict
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return RemoteObject{}, responseError("put CalDAV object", response)
	}
	calendar, err := ical.NewDecoder(strings.NewReader(payload)).Decode()
	if err != nil {
		return RemoteObject{}, fmt.Errorf("decode saved CalDAV object: %w", err)
	}
	_, uid, err := caldav.ValidateCalendarObject(calendar)
	if err != nil {
		return RemoteObject{}, fmt.Errorf("validate saved CalDAV object: %w", err)
	}
	newETag := response.Header.Get("ETag")
	if newETag == "" {
		stored, getErr := provider.client.GetCalendarObject(ctx, objectPath)
		if getErr != nil {
			return RemoteObject{}, fmt.Errorf("read saved CalDAV object: %w", getErr)
		}
		newETag = stored.ETag
	}
	return RemoteObject{
		Path:        objectPath,
		ETag:        newETag,
		UID:         uid,
		Payload:     payload,
		PayloadHash: hashText(payload),
	}, nil
}

func (provider *CalDAVProvider) Delete(ctx context.Context, objectPath, etag string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, provider.resolve(objectPath), nil)
	if err != nil {
		return fmt.Errorf("build CalDAV DELETE: %w", err)
	}
	if etag != "" {
		request.Header.Set("If-Match", etagHeader(etag))
	}
	response, err := provider.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("delete CalDAV object: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusPreconditionFailed {
		return ErrConflict
	}
	if response.StatusCode == http.StatusNotFound {
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return responseError("delete CalDAV object", response)
	}
	return nil
}

func (provider *CalDAVProvider) createCalendar(ctx context.Context, homeSet, name string) error {
	calendarPath := pathpkg.Join(homeSet, name) + "/"
	body := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set><D:prop>
    <D:displayname>%s</D:displayname>
    <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</C:mkcalendar>`, xmlEscape(name))
	request, err := http.NewRequestWithContext(ctx, "MKCALENDAR", provider.resolve(calendarPath), strings.NewReader(body))
	if err != nil {
		return fmt.Errorf("build CalDAV calendar creation: %w", err)
	}
	request.Header.Set("Content-Type", "application/xml; charset=utf-8")
	response, err := provider.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("create CalDAV calendar: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return responseError("create CalDAV calendar", response)
	}
	return nil
}

func (provider *CalDAVProvider) resolve(path string) string {
	reference := &url.URL{Path: path}
	return provider.endpoint.ResolveReference(reference).String()
}

func selectCalendar(calendars []caldav.Calendar, name string) (caldav.Calendar, bool) {
	for _, calendar := range calendars {
		if strings.EqualFold(strings.TrimSpace(calendar.Name), strings.TrimSpace(name)) && supportsEvents(calendar) {
			return calendar, true
		}
	}
	return caldav.Calendar{}, false
}

func supportsEvents(calendar caldav.Calendar) bool {
	if len(calendar.SupportedComponentSet) == 0 {
		return true
	}
	for _, component := range calendar.SupportedComponentSet {
		if strings.EqualFold(component, ical.CompEvent) {
			return true
		}
	}
	return false
}

func calendarChoice(calendar caldav.Calendar) CalendarChoice {
	return CalendarChoice{
		Path:        calendar.Path,
		Name:        calendar.Name,
		Description: calendar.Description,
		Components:  calendar.SupportedComponentSet,
	}
}

func calendarChoices(calendars []caldav.Calendar) []CalendarChoice {
	choices := make([]CalendarChoice, 0, len(calendars))
	for _, calendar := range calendars {
		choices = append(choices, calendarChoice(calendar))
	}
	return choices
}

func encodeCalendar(calendar *ical.Calendar) (string, error) {
	var buffer bytes.Buffer
	if err := ical.NewEncoder(&buffer).Encode(calendar); err != nil {
		return "", err
	}
	return buffer.String(), nil
}

func responseError(action string, response *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	detail := strings.TrimSpace(string(body))
	if detail == "" {
		return fmt.Errorf("%s: %s", action, response.Status)
	}
	return fmt.Errorf("%s: %s: %s", action, response.Status, detail)
}

func etagHeader(etag string) string {
	if strings.HasPrefix(etag, `"`) || strings.HasPrefix(etag, "W/") {
		return etag
	}
	return strconv.Quote(etag)
}

func xmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")
	return replacer.Replace(value)
}
