package domain

const (
	ChartMonthlyTotals   = "monthly_totals"
	ChartByCategory      = "by_category"
	ChartCalendarHeatmap = "calendar_heatmap"

	ChartRunningBalance     = "running_balance"
	ChartIntentTrends       = "intent_trends"
	ChartSmallPurchases     = "small_purchases"
	ChartWorkdayRoutine     = "workday_routine"
	ChartWeekdayHourHeatmap = "weekday_hour_heatmap"
	ChartNoSpendCalendar    = "no_spend_calendar"
)

// ChartDef is one chart entry of dashboard.toml.
type ChartDef struct {
	Title string
	Type  string
}
