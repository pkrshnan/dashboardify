package accessauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

const assertionHeader = "Cf-Access-Jwt-Assertion"

type Config struct {
	TeamDomain     string
	Audience       string
	AllowedSubject string
}

type Identity struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
	Type    string `json:"type"`
}

type Validator struct {
	verifier       *oidc.IDTokenVerifier
	allowedSubject string
}

func New(cfg Config) (*Validator, error) {
	issuer, err := normalizeTeamDomain(cfg.TeamDomain)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.Audience) == "" {
		return nil, errors.New("Cloudflare Access application audience is required")
	}
	if strings.TrimSpace(cfg.AllowedSubject) == "" {
		return nil, errors.New("Cloudflare Access allowed subject is required")
	}
	return newValidator(
		issuer,
		issuer+"/cdn-cgi/access/certs",
		strings.TrimSpace(cfg.Audience),
		strings.TrimSpace(cfg.AllowedSubject),
	), nil
}

func newValidator(issuer, jwksURL, audience, allowedSubject string) *Validator {
	keySet := oidc.NewRemoteKeySet(context.Background(), jwksURL)
	verifier := oidc.NewVerifier(issuer, keySet, &oidc.Config{
		ClientID:             audience,
		SupportedSigningAlgs: []string{"RS256"},
	})
	return &Validator{verifier: verifier, allowedSubject: allowedSubject}
}

func normalizeTeamDomain(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("Cloudflare Access team domain is required")
	}
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", errors.New("Cloudflare Access team domain is invalid")
	}
	if parsed.Scheme != "https" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", errors.New("Cloudflare Access team domain must be an HTTPS origin")
	}
	host := strings.ToLower(parsed.Hostname())
	if !strings.HasSuffix(host, ".cloudflareaccess.com") || host == ".cloudflareaccess.com" {
		return "", errors.New("Cloudflare Access team domain must end in .cloudflareaccess.com")
	}
	if parsed.Port() != "" {
		return "", errors.New("Cloudflare Access team domain must not include a port")
	}
	return "https://" + host, nil
}

type identityContextKey struct{}

func IdentityFromContext(ctx context.Context) (Identity, bool) {
	identity, ok := ctx.Value(identityContextKey{}).(Identity)
	return identity, ok
}

func (validator *Validator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		rawToken := strings.TrimSpace(request.Header.Get(assertionHeader))
		if rawToken == "" {
			unauthorized(response)
			return
		}

		token, err := validator.verifier.Verify(request.Context(), rawToken)
		if err != nil {
			unauthorized(response)
			return
		}

		var identity Identity
		if err := token.Claims(&identity); err != nil || identity.Type != "app" || identity.Subject == "" || token.Subject != identity.Subject {
			unauthorized(response)
			return
		}
		if identity.Subject != validator.allowedSubject {
			response.Header().Set("Cache-Control", "no-store")
			http.Error(response, "forbidden", http.StatusForbidden)
			return
		}

		ctx := context.WithValue(request.Context(), identityContextKey{}, identity)
		next.ServeHTTP(response, request.WithContext(ctx))
	})
}

func unauthorized(response http.ResponseWriter) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("WWW-Authenticate", "CloudflareAccess")
	http.Error(response, "unauthorized", http.StatusUnauthorized)
}
