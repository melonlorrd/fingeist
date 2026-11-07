export namespace config {
	
	export class Settings {
	    name: string;
	    currency: string;
	    smallPurchaseThresholds: string[];
	    workdays: string[];
	    targetAllocation: Record<string, number>;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.currency = source["currency"];
	        this.smallPurchaseThresholds = source["smallPurchaseThresholds"];
	        this.workdays = source["workdays"];
	        this.targetAllocation = source["targetAllocation"];
	    }
	}

}

export namespace main {
	
	export class CategoryView {
	    name: string;
	    color: string;
	    archived: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CategoryView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.color = source["color"];
	        this.archived = source["archived"];
	    }
	}
	export class Boot {
	    needsSetup: boolean;
	    projectName: string;
	    currency: string;
	    categories: CategoryView[];
	    settings: config.Settings;
	    now: string;
	    today: string;
	    problems: storage.Problem[];
	    unsaved: boolean;
	    holdingProblems: storage.Problem[];
	    holdingsUnsaved: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Boot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.needsSetup = source["needsSetup"];
	        this.projectName = source["projectName"];
	        this.currency = source["currency"];
	        this.categories = this.convertValues(source["categories"], CategoryView);
	        this.settings = this.convertValues(source["settings"], config.Settings);
	        this.now = source["now"];
	        this.today = source["today"];
	        this.problems = this.convertValues(source["problems"], storage.Problem);
	        this.unsaved = source["unsaved"];
	        this.holdingProblems = this.convertValues(source["holdingProblems"], storage.Problem);
	        this.holdingsUnsaved = source["holdingsUnsaved"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class DashboardData {
	    summary: report.Summary;
	    charts: report.Chart[];
	
	    static createFrom(source: any = {}) {
	        return new DashboardData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.summary = this.convertValues(source["summary"], report.Summary);
	        this.charts = this.convertValues(source["charts"], report.Chart);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PriceUpdate {
	    updated: number;
	    failures: prices.Failure[];
	
	    static createFrom(source: any = {}) {
	        return new PriceUpdate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.updated = source["updated"];
	        this.failures = this.convertValues(source["failures"], prices.Failure);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Range {
	    from: string;
	    to: string;
	
	    static createFrom(source: any = {}) {
	        return new Range(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.from = source["from"];
	        this.to = source["to"];
	    }
	}

}

export namespace portfolio {
	
	export class Allocation {
	    class: string;
	    label: string;
	    value: string;
	    actualPct: string;
	    actualBp: number;
	    hasTarget: boolean;
	    targetPct: string;
	    targetBp: number;
	    drift: string;
	    driftTrend: string;
	
	    static createFrom(source: any = {}) {
	        return new Allocation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.class = source["class"];
	        this.label = source["label"];
	        this.value = source["value"];
	        this.actualPct = source["actualPct"];
	        this.actualBp = source["actualBp"];
	        this.hasTarget = source["hasTarget"];
	        this.targetPct = source["targetPct"];
	        this.targetBp = source["targetBp"];
	        this.drift = source["drift"];
	        this.driftTrend = source["driftTrend"];
	    }
	}
	export class Row {
	    id: string;
	    class: string;
	    classLabel: string;
	    name: string;
	    ticker: string;
	    units: string;
	    avgBuyPrice: string;
	    currentPrice: string;
	    value: string;
	    invested: string;
	    gain: string;
	    gainPct: string;
	    gainTrend: string;
	    priceAsOf: string;
	    priceSource: string;
	    outOfDate: boolean;
	    notes: string;
	
	    static createFrom(source: any = {}) {
	        return new Row(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.class = source["class"];
	        this.classLabel = source["classLabel"];
	        this.name = source["name"];
	        this.ticker = source["ticker"];
	        this.units = source["units"];
	        this.avgBuyPrice = source["avgBuyPrice"];
	        this.currentPrice = source["currentPrice"];
	        this.value = source["value"];
	        this.invested = source["invested"];
	        this.gain = source["gain"];
	        this.gainPct = source["gainPct"];
	        this.gainTrend = source["gainTrend"];
	        this.priceAsOf = source["priceAsOf"];
	        this.priceSource = source["priceSource"];
	        this.outOfDate = source["outOfDate"];
	        this.notes = source["notes"];
	    }
	}
	export class View {
	    netWorth: string;
	    portfolioValue: string;
	    totalInvested: string;
	    totalReturns: string;
	    totalReturnsPct: string;
	    returnsTrend: string;
	    allocation: Allocation[];
	    holdings: Row[];
	
	    static createFrom(source: any = {}) {
	        return new View(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.netWorth = source["netWorth"];
	        this.portfolioValue = source["portfolioValue"];
	        this.totalInvested = source["totalInvested"];
	        this.totalReturns = source["totalReturns"];
	        this.totalReturnsPct = source["totalReturnsPct"];
	        this.returnsTrend = source["returnsTrend"];
	        this.allocation = this.convertValues(source["allocation"], Allocation);
	        this.holdings = this.convertValues(source["holdings"], Row);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace prices {
	
	export class Failure {
	    name: string;
	    reason: string;
	
	    static createFrom(source: any = {}) {
	        return new Failure(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.reason = source["reason"];
	    }
	}

}

export namespace report {
	
	export class Amount {
	    minor: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Amount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.minor = source["minor"];
	        this.text = source["text"];
	    }
	}
	export class BalancePoint {
	    date: string;
	    balance: Amount;
	
	    static createFrom(source: any = {}) {
	        return new BalancePoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.balance = this.convertValues(source["balance"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Card {
	    key: string;
	    label: string;
	    value: Amount;
	    detail: string;
	    change: string;
	
	    static createFrom(source: any = {}) {
	        return new Card(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.value = this.convertValues(source["value"], Amount);
	        this.detail = source["detail"];
	        this.change = source["change"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CategoryTotal {
	    category: string;
	    color: string;
	    spent: Amount;
	
	    static createFrom(source: any = {}) {
	        return new CategoryTotal(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.category = source["category"];
	        this.color = source["color"];
	        this.spent = this.convertValues(source["spent"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TxnRef {
	    id: string;
	    date: string;
	    merchant: string;
	    amount: Amount;
	
	    static createFrom(source: any = {}) {
	        return new TxnRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.date = source["date"];
	        this.merchant = source["merchant"];
	        this.amount = this.convertValues(source["amount"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NoSpendDay {
	    date: string;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new NoSpendDay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.status = source["status"];
	    }
	}
	export class NoSpendMonth {
	    month: string;
	    days: NoSpendDay[];
	    zeroDays: number;
	    bestStreak: number;
	
	    static createFrom(source: any = {}) {
	        return new NoSpendMonth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.days = this.convertValues(source["days"], NoSpendDay);
	        this.zeroDays = source["zeroDays"];
	        this.bestStreak = source["bestStreak"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HeatCell {
	    weekday: number;
	    hour: number;
	    spent: Amount;
	
	    static createFrom(source: any = {}) {
	        return new HeatCell(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.weekday = source["weekday"];
	        this.hour = source["hour"];
	        this.spent = this.convertValues(source["spent"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NameStat {
	    name: string;
	    count: number;
	    average: Amount;
	
	    static createFrom(source: any = {}) {
	        return new NameStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.count = source["count"];
	        this.average = this.convertValues(source["average"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HourStat {
	    hour: number;
	    occurrences: number;
	    total: Amount;
	    average: Amount;
	    share: string;
	    categories: CategoryTotal[];
	    merchants: NameStat[];
	
	    static createFrom(source: any = {}) {
	        return new HourStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hour = source["hour"];
	        this.occurrences = source["occurrences"];
	        this.total = this.convertValues(source["total"], Amount);
	        this.average = this.convertValues(source["average"], Amount);
	        this.share = source["share"];
	        this.categories = this.convertValues(source["categories"], CategoryTotal);
	        this.merchants = this.convertValues(source["merchants"], NameStat);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SmallStat {
	    threshold: Amount;
	    count: number;
	    total: Amount;
	    share: string;
	    shareBp: number;
	
	    static createFrom(source: any = {}) {
	        return new SmallStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.threshold = this.convertValues(source["threshold"], Amount);
	        this.count = source["count"];
	        this.total = this.convertValues(source["total"], Amount);
	        this.share = source["share"];
	        this.shareBp = source["shareBp"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class IntentMonth {
	    month: string;
	    need: Amount;
	    want: Amount;
	    impulse: Amount;
	
	    static createFrom(source: any = {}) {
	        return new IntentMonth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.need = this.convertValues(source["need"], Amount);
	        this.want = this.convertValues(source["want"], Amount);
	        this.impulse = this.convertValues(source["impulse"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DayTotal {
	    date: string;
	    spent: Amount;
	
	    static createFrom(source: any = {}) {
	        return new DayTotal(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.spent = this.convertValues(source["spent"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MonthTotal {
	    month: string;
	    income: Amount;
	    expenses: Amount;
	    net: Amount;
	
	    static createFrom(source: any = {}) {
	        return new MonthTotal(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.income = this.convertValues(source["income"], Amount);
	        this.expenses = this.convertValues(source["expenses"], Amount);
	        this.net = this.convertValues(source["net"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Chart {
	    title: string;
	    type: string;
	    error?: string;
	    months: MonthTotal[];
	    categories: CategoryTotal[];
	    days: DayTotal[];
	    from?: string;
	    to?: string;
	    max: Amount;
	    balance: BalancePoint[];
	    intentMonths: IntentMonth[];
	    noIntent: number;
	    small: SmallStat[];
	    expenseCount: number;
	    expenseTotal: Amount;
	    hours: HourStat[];
	    workdays: number;
	    cells: HeatCell[];
	    noSpend: NoSpendMonth[];
	    currentStreak: number;
	    noTime: TxnRef[];
	
	    static createFrom(source: any = {}) {
	        return new Chart(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.type = source["type"];
	        this.error = source["error"];
	        this.months = this.convertValues(source["months"], MonthTotal);
	        this.categories = this.convertValues(source["categories"], CategoryTotal);
	        this.days = this.convertValues(source["days"], DayTotal);
	        this.from = source["from"];
	        this.to = source["to"];
	        this.max = this.convertValues(source["max"], Amount);
	        this.balance = this.convertValues(source["balance"], BalancePoint);
	        this.intentMonths = this.convertValues(source["intentMonths"], IntentMonth);
	        this.noIntent = source["noIntent"];
	        this.small = this.convertValues(source["small"], SmallStat);
	        this.expenseCount = source["expenseCount"];
	        this.expenseTotal = this.convertValues(source["expenseTotal"], Amount);
	        this.hours = this.convertValues(source["hours"], HourStat);
	        this.workdays = source["workdays"];
	        this.cells = this.convertValues(source["cells"], HeatCell);
	        this.noSpend = this.convertValues(source["noSpend"], NoSpendMonth);
	        this.currentStreak = source["currentStreak"];
	        this.noTime = this.convertValues(source["noTime"], TxnRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	export class LedgerRow {
	    id: string;
	    date: string;
	    time: string;
	    merchant: string;
	    note: string;
	    category: string;
	    categoryColor: string;
	    tags: string[];
	    intent: string;
	    amount: Amount;
	
	    static createFrom(source: any = {}) {
	        return new LedgerRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.date = source["date"];
	        this.time = source["time"];
	        this.merchant = source["merchant"];
	        this.note = source["note"];
	        this.category = source["category"];
	        this.categoryColor = source["categoryColor"];
	        this.tags = source["tags"];
	        this.intent = source["intent"];
	        this.amount = this.convertValues(source["amount"], Amount);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LedgerDay {
	    date: string;
	    total: Amount;
	    rows: LedgerRow[];
	
	    static createFrom(source: any = {}) {
	        return new LedgerDay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.total = this.convertValues(source["total"], Amount);
	        this.rows = this.convertValues(source["rows"], LedgerRow);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LedgerData {
	    days: LedgerDay[];
	    totalDays: number;
	    months: string[];
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new LedgerData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.days = this.convertValues(source["days"], LedgerDay);
	        this.totalDays = source["totalDays"];
	        this.months = source["months"];
	        this.count = source["count"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LedgerQuery {
	    search: string;
	    month: string;
	    category: string;
	    filter: string;
	    limit: number;
	
	    static createFrom(source: any = {}) {
	        return new LedgerQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.search = source["search"];
	        this.month = source["month"];
	        this.category = source["category"];
	        this.filter = source["filter"];
	        this.limit = source["limit"];
	    }
	}
	
	
	
	
	
	
	export class Summary {
	    cards: Card[];
	
	    static createFrom(source: any = {}) {
	        return new Summary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cards = this.convertValues(source["cards"], Card);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace storage {
	
	export class Fields {
	    id: string;
	    time: string;
	    amount: string;
	    category: string;
	    merchant: string;
	    note: string;
	    tags: string;
	    intent: string;
	
	    static createFrom(source: any = {}) {
	        return new Fields(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.time = source["time"];
	        this.amount = source["amount"];
	        this.category = source["category"];
	        this.merchant = source["merchant"];
	        this.note = source["note"];
	        this.tags = source["tags"];
	        this.intent = source["intent"];
	    }
	}
	export class HoldingFields {
	    id: string;
	    class: string;
	    name: string;
	    ticker: string;
	    units: string;
	    avgBuyPrice: string;
	    currentPrice: string;
	    priceAsOf: string;
	    priceSource: string;
	    notes: string;
	
	    static createFrom(source: any = {}) {
	        return new HoldingFields(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.class = source["class"];
	        this.name = source["name"];
	        this.ticker = source["ticker"];
	        this.units = source["units"];
	        this.avgBuyPrice = source["avgBuyPrice"];
	        this.currentPrice = source["currentPrice"];
	        this.priceAsOf = source["priceAsOf"];
	        this.priceSource = source["priceSource"];
	        this.notes = source["notes"];
	    }
	}
	export class Problem {
	    line: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new Problem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.line = source["line"];
	        this.message = source["message"];
	    }
	}

}

