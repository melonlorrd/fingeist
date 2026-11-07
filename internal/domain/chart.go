package domain

const (
	ChartMonthlyTotals   = "monthly_totals"
	ChartByCategory      = "by_category"
	ChartCalendarHeatmap = "calendar_heatmap"
)

// ChartDef is one chart entry of dashboard.toml.
type ChartDef struct {
	Title string
	Type  string
}
