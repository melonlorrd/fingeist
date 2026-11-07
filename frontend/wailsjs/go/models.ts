export namespace main {
	
	export class State {
	    needsSetup: boolean;
	    projectName: string;
	    currency: string;
	    categories: string[];
	    now: string;
	    rows: storage.Fields[];
	    charts: report.Chart[];
	    problems: storage.Problem[];
	    unsaved: boolean;
	
	    static createFrom(source: any = {}) {
	        return new State(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.needsSetup = source["needsSetup"];
	        this.projectName = source["projectName"];
	        this.currency = source["currency"];
	        this.categories = source["categories"];
	        this.now = source["now"];
	        this.rows = this.convertValues(source["rows"], storage.Fields);
	        this.charts = this.convertValues(source["charts"], report.Chart);
	        this.problems = this.convertValues(source["problems"], storage.Problem);
	        this.unsaved = source["unsaved"];
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
	export class CategoryTotal {
	    category: string;
	    spent: Amount;
	
	    static createFrom(source: any = {}) {
	        return new CategoryTotal(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.category = source["category"];
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

