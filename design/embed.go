package design

import _ "embed"

// DashboardHTML is the responsive dashboard prototype embedded into the service binary.
//
//go:embed dashboard.html
var DashboardHTML []byte
