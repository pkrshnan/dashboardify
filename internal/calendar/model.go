package calendar

import "time"

const appleIntegrationID = "apple-calendar"

type Config struct {
	Enabled      bool
	Endpoint     string
	Username     string
	Password     string
	CalendarName string
}

type Integration struct {
	ID            string
	Endpoint      string
	PrincipalPath string
	HomeSetPath   string
	CalendarPath  string
	CalendarName  string
	SyncToken     string
	State         string
	LastAttemptAt *time.Time
	LastSuccessAt *time.Time
	LastError     string
	UpdatedAt     time.Time
}

type Status struct {
	Configured    bool       `json:"configured"`
	State         string     `json:"state"`
	CalendarName  string     `json:"calendar_name,omitempty"`
	CalendarPath  string     `json:"calendar_path,omitempty"`
	LastAttemptAt *time.Time `json:"last_attempt_at,omitempty"`
	LastSuccessAt *time.Time `json:"last_success_at,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	ConflictCount int        `json:"conflict_count"`
}

type CalendarChoice struct {
	Path        string   `json:"path"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Components  []string `json:"components"`
}

type Discovery struct {
	PrincipalPath string           `json:"principal_path"`
	HomeSetPath   string           `json:"home_set_path"`
	Selected      CalendarChoice   `json:"selected"`
	Calendars     []CalendarChoice `json:"calendars"`
}

type RemoteObject struct {
	Path        string
	ETag        string
	UID         string
	Payload     string
	PayloadHash string
	DeletedAt   *time.Time
	UpdatedAt   time.Time
}

type NativeEvent struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	StartAt   *time.Time `json:"start_at,omitempty"`
	EndAt     *time.Time `json:"end_at,omitempty"`
	StartDate string     `json:"start_date,omitempty"`
	EndDate   string     `json:"end_date,omitempty"`
	AllDay    bool       `json:"all_day,omitempty"`
	Timezone  string     `json:"timezone"`
	Place     string     `json:"place,omitempty"`
	Status    string     `json:"status"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type EventLink struct {
	LocalEventID         string
	RemotePath           string
	RemoteUID            string
	ETag                 string
	LastLocalHash        string
	LastRemoteHash       string
	ConflictState        string
	PendingRemotePayload string
	RemoteDeleted        bool
	UpdatedAt            time.Time
}

type Conflict struct {
	LocalEventID string    `json:"local_event_id"`
	RemotePath   string    `json:"remote_path"`
	Kind         string    `json:"kind"`
	Title        string    `json:"title"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type AgendaEvent struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	StartAt    *time.Time `json:"start_at,omitempty"`
	EndAt      *time.Time `json:"end_at,omitempty"`
	StartDate  string     `json:"start_date,omitempty"`
	EndDate    string     `json:"end_date,omitempty"`
	AllDay     bool       `json:"all_day,omitempty"`
	Timezone   string     `json:"timezone"`
	Place      string     `json:"place,omitempty"`
	Status     string     `json:"status"`
	Provider   string     `json:"provider"`
	ReadOnly   bool       `json:"read_only"`
	RemotePath string     `json:"remote_path,omitempty"`
}

type SyncSummary struct {
	Pulled    int       `json:"pulled"`
	Pushed    int       `json:"pushed"`
	Deleted   int       `json:"deleted"`
	Conflicts int       `json:"conflicts"`
	SyncedAt  time.Time `json:"synced_at"`
}
