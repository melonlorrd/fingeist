package report

import (
	"fmt"

	"el-costas/internal/domain"
)

type Card struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Value  Amount `json:"value"`
	Detail string `json:"detail"`
	Change string `json:"change"`
}

type Summary struct {
	Cards []Card `json:"cards"`
}

type totals struct {
	spent, income domain.Money
	expenseCount  int
}

// Summarize builds the dashboard cards for the scope, each compared with the previous period of the same length.
func Summarize(txns []domain.Transaction, project domain.Project, scope Scope) Summary {
	current := sumUp(scope.Filter(txns))

	days := 1
	var previous totals
	hasPrevious := false
	if start, end, ok := scope.pastBounds(txns); ok {
		days = daysBetween(start, end) + 1
		if scope.From != "" {
			previousScope := Scope{From: addDays(start, -days), To: addDays(start, -1)}
			previousTxns := previousScope.Filter(txns)
			previous, hasPrevious = sumUp(previousTxns), len(previousTxns) > 0
		}
	}

	avg := func(t totals) domain.Money { return t.spent.DivideRounded(int64(days)) }
	card := func(key, label string, now, before domain.Money, detail string) Card {
		return Card{
			Key: key, Label: label, Value: amountOf(now, project), Detail: detail,
			Change: changeText(now, before, hasPrevious),
		}
	}
	return Summary{Cards: []Card{
		card("spent", "Total spent", current.spent, previous.spent, ""),
		card("income", "Total income", current.income, previous.income, ""),
		card("savings", "Net savings", current.income-current.spent, previous.income-previous.spent, ""),
		card("average", "Average daily spend", avg(current), avg(previous), fmt.Sprintf("over %d expense transactions", current.expenseCount)),
	}}
}

func sumUp(txns []domain.Transaction) totals {
	var t totals
	for _, txn := range txns {
		if txn.IsExpense() {
			t.spent -= txn.Amount
			t.expenseCount++
		} else {
			t.income += txn.Amount
		}
	}
	return t
}

func changeText(now, before domain.Money, hasPrevious bool) string {
	switch {
	case !hasPrevious:
		return "No previous data"
	case before == 0 && now == 0:
		return "No change"
	case before == 0:
		return "Up from zero"
	}
	denominator := before
	if denominator < 0 {
		denominator = -denominator
	}
	return domain.FormatBasisPoints(domain.BasisPoints(int64(now-before), int64(denominator)), true) + " vs previous period"
}
