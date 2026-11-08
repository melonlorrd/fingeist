package report

import (
	"cmp"
	"slices"
	"strings"
	"time"

	"fingeist/internal/domain"
)

// runningBalance is the cumulative net per day over the range, starting from what came before it.
func runningBalance(all []domain.Transaction, project domain.Project, scope Scope) []BalancePoint {
	points := []BalancePoint{}
	start, end, ok := scope.bounds(all)
	if !ok {
		return points
	}

	latest := scope.Today
	for _, t := range all {
		latest = max(latest, t.Date())
	}
	end = min(end, latest)

	var balance domain.Money
	netByDay := map[string]domain.Money{}
	for _, t := range all {
		if date := t.Date(); date < start {
			balance += t.Amount
		} else {
			netByDay[date] += t.Amount
		}
	}
	eachDay(start, end, func(date string) {
		balance += netByDay[date]
		points = append(points, BalancePoint{Date: date, Balance: amountOf(balance, project)})
	})
	return points
}

func intentTrends(txns []domain.Transaction, project domain.Project) (months []IntentMonth, noIntent int) {
	type sums struct{ need, want, impulse domain.Money }
	byMonth := map[monthKey]*sums{}
	var first, last monthKey
	seen := false
	for _, t := range txns {
		if !t.IsExpense() {
			continue
		}
		if t.Intent == domain.IntentNone {
			noIntent++
			continue
		}
		key := monthOf(t.Time)
		if !seen || key < first {
			first = key
		}
		if !seen || key > last {
			last = key
		}
		seen = true
		if byMonth[key] == nil {
			byMonth[key] = &sums{}
		}
		switch t.Intent {
		case domain.IntentNeed:
			byMonth[key].need -= t.Amount
		case domain.IntentWant:
			byMonth[key].want -= t.Amount
		case domain.IntentImpulse:
			byMonth[key].impulse -= t.Amount
		}
	}

	months = []IntentMonth{}
	for key := first; seen && key <= last; key++ {
		s := byMonth[key]
		if s == nil {
			s = &sums{}
		}
		months = append(months, IntentMonth{
			Month: key.String(), Need: amountOf(s.need, project),
			Want: amountOf(s.want, project), Impulse: amountOf(s.impulse, project),
		})
	}
	return months, noIntent
}

func smallPurchases(txns []domain.Transaction, project domain.Project) (stats []SmallStat, count int, total Amount) {
	var expenseTotal domain.Money
	for _, t := range txns {
		if t.IsExpense() {
			count++
			expenseTotal -= t.Amount
		}
	}

	stats = []SmallStat{}
	for _, threshold := range project.SmallPurchaseThresholds {
		var smallCount int
		var smallTotal domain.Money
		for _, t := range txns {
			if t.IsExpense() && -t.Amount <= threshold {
				smallCount++
				smallTotal -= t.Amount
			}
		}
		bp := domain.BasisPoints(int64(smallTotal), int64(expenseTotal))
		stats = append(stats, SmallStat{
			Threshold: amountOf(threshold, project), Count: smallCount, Total: amountOf(smallTotal, project),
			Share: domain.FormatBasisPoints(bp, false), ShareBP: bp,
		})
	}
	return stats, count, amountOf(expenseTotal, project)
}

type hourBucket struct {
	total      domain.Money
	count      int
	days       map[string]bool
	categories map[string]domain.Money
	merchants  map[string]*merchantBucket
}

type merchantBucket struct {
	total domain.Money
	count int
}

// workdayRoutine buckets expenses on workdays by the wall-clock hour; rows without a time are left out.
func workdayRoutine(txns, all []domain.Transaction, project domain.Project, scope Scope) ([]HourStat, int) {
	workdays := 0
	if start, end, ok := scope.pastBounds(all); ok {
		eachDay(start, end, func(date string) {
			if project.IsWorkday(weekdayOf(date)) {
				workdays++
			}
		})
	}

	var buckets [24]hourBucket
	for _, t := range txns {
		if !t.IsExpense() || t.TimeUnknown || !project.IsWorkday(weekdayOf(t.Date())) {
			continue
		}
		b := &buckets[t.Time.Hour()]
		if b.days == nil {
			b.days, b.categories, b.merchants = map[string]bool{}, map[string]domain.Money{}, map[string]*merchantBucket{}
		}
		b.total -= t.Amount
		b.count++
		b.days[t.Date()] = true
		b.categories[categoryName(project, t.Category)] -= t.Amount
		if name := merchantOrNote(t); name != "" {
			if b.merchants[name] == nil {
				b.merchants[name] = &merchantBucket{}
			}
			b.merchants[name].total -= t.Amount
			b.merchants[name].count++
		}
	}

	hours := make([]HourStat, 24)
	for hour := range hours {
		b := buckets[hour]
		categories := rankCategories(b.categories, project)
		hours[hour] = HourStat{
			Hour: hour, Occurrences: b.count, Total: amountOf(b.total, project),
			Average:    amountOf(b.total.DivideRounded(int64(b.count)), project),
			Share:      domain.FormatBasisPoints(domain.BasisPoints(int64(len(b.days)), int64(workdays)), false),
			Categories: categories[:min(topCount, len(categories))],
			Merchants:  topMerchants(b.merchants, project),
		}
	}
	return hours, workdays
}

func topMerchants(buckets map[string]*merchantBucket, project domain.Project) []NameStat {
	stats := make([]NameStat, 0, len(buckets))
	for name, b := range buckets {
		stats = append(stats, NameStat{Name: name, Count: b.count, Average: amountOf(b.total.DivideRounded(int64(b.count)), project)})
	}
	slices.SortFunc(stats, func(a, b NameStat) int {
		return cmp.Or(cmp.Compare(b.Count, a.Count), cmp.Compare(a.Name, b.Name))
	})
	return stats[:min(topCount, len(stats))]
}

func merchantOrNote(t domain.Transaction) string {
	if merchant := strings.TrimSpace(t.Merchant); merchant != "" {
		return merchant
	}
	return strings.TrimSpace(t.Note)
}

func weekdayHours(txns []domain.Transaction, project domain.Project) (cells []HeatCell, peak Amount) {
	type slot struct{ weekday, hour int }
	spent := map[slot]domain.Money{}
	for _, t := range txns {
		if t.IsExpense() && !t.TimeUnknown {
			spent[slot{mondayFirst(weekdayOf(t.Date())), t.Time.Hour()}] -= t.Amount
		}
	}

	cells = make([]HeatCell, 0, len(spent))
	var biggest domain.Money
	for s, total := range spent {
		cells = append(cells, HeatCell{Weekday: s.weekday, Hour: s.hour, Spent: amountOf(total, project)})
		biggest = max(biggest, total)
	}
	slices.SortFunc(cells, func(a, b HeatCell) int {
		return cmp.Or(cmp.Compare(a.Weekday, b.Weekday), cmp.Compare(a.Hour, b.Hour))
	})
	return cells, amountOf(biggest, project)
}

func mondayFirst(day time.Weekday) int {
	return (int(day) + 6) % 7
}

// noTimeRefs lists the expenses that the hour charts had to leave out.
func noTimeRefs(txns []domain.Transaction, project domain.Project) []TxnRef {
	refs := []TxnRef{}
	for _, t := range txns {
		if t.IsExpense() && t.TimeUnknown {
			refs = append(refs, TxnRef{ID: t.ID, Date: t.Date(), Merchant: t.Merchant, Amount: amountOf(t.Amount, project)})
		}
	}
	slices.SortFunc(refs, func(a, b TxnRef) int { return cmp.Compare(b.Date, a.Date) })
	return refs
}

const (
	dayZero    = "zero"
	daySpent   = "spent"
	dayFuture  = "future"
	dayOutside = "outside"
)

// noSpendCalendar marks each day of the range's months as spent or zero-expense. Days before the
// first transaction or after today never count as zero-expense days.
func noSpendCalendar(all []domain.Transaction, scope Scope) (months []NoSpendMonth, currentStreak int) {
	months = []NoSpendMonth{}
	if len(all) == 0 {
		return months, 0
	}
	start, end, ok := scope.pastBounds(all)
	if !ok {
		return months, 0
	}

	first, last := all[0].Date(), all[0].Date()
	spentOn := map[string]bool{}
	for _, t := range all {
		first, last = min(first, t.Date()), max(last, t.Date())
		if t.IsExpense() {
			spentOn[t.Date()] = true
		}
	}
	today := scope.Today
	if today == "" {
		today = last
	}

	status := func(date string) string {
		switch {
		case date > today:
			return dayFuture
		case date < first || date < start || date > end:
			return dayOutside
		case spentOn[date]:
			return daySpent
		}
		return dayZero
	}

	for month := monthOfDate(start); month <= monthOfDate(end); month = monthOfDate(addDays(month+"-28", 4)) {
		months = append(months, buildMonth(month, status))
	}

	for date := today; date >= first && !spentOn[date]; date = addDays(date, -1) {
		currentStreak++
	}
	return months, currentStreak
}

func buildMonth(month string, status func(date string) string) NoSpendMonth {
	result := NoSpendMonth{Month: month, Days: []NoSpendDay{}}
	run := 0
	for date := month + "-01"; monthOfDate(date) == month; date = addDays(date, 1) {
		day := NoSpendDay{Date: date, Status: status(date)}
		result.Days = append(result.Days, day)
		if day.Status == dayZero {
			result.ZeroDays++
			run++
			result.BestStreak = max(result.BestStreak, run)
		} else {
			run = 0
		}
	}
	return result
}
