import ODataModel from "sap/ui/model/odata/v4/ODataModel";

export interface DayBucket {
	day: string;
	label: string;
	error: number;
	warning: number;
	success: number;
}

export interface ChartData {
	days: DayBucket[];
	truncated: boolean;
}

/**
 * Aggregiert die Log-Eintraege der letzten n Tage nach Tag und Log-Typ.
 *
 * Die Aggregation passiert im Browser, weil der Service kein OData-$apply
 * anbietet (kein @Aggregation.applySupported auf ZLE_AUST_C_APPL_LOG,
 * siehe CLAUDE.md). Anders als die frühere Donut-Karte, die stur 2000
 * Saetze zog, wird hier serverseitig auf das Datumsfenster gefiltert und
 * JsonPayload bewusst NICHT selektiert (unbegrenztes Edm.String).
 *
 * CreatedAt ist im Consumption-View bereits ein Datum (Edm.Date, per
 * tstmp_to_dats aus dem Zeitstempel) - deshalb ist das Filterliteral ein
 * reines ISO-Datum ohne Anfuehrungszeichen und ohne Zeitanteil.
 */

function isoDay(oDate: Date): string {
	const sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
	const sDay = String(oDate.getDate()).padStart(2, "0");
	return `${String(oDate.getFullYear())}-${sMonth}-${sDay}`;
}

function dayLabel(oDate: Date): string {
	const sDay = String(oDate.getDate()).padStart(2, "0");
	const sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
	return `${sDay}.${sMonth}.`;
}

/**
 * Legt fuer jeden der n Tage einen Eimer an - auch fuer Tage ohne
 * Eintraege. Sonst reisst der Verlauf im Chart Luecken.
 */
function emptyBuckets(nDays: number): DayBucket[] {
	const aBuckets: DayBucket[] = [];
	const oToday = new Date();
	for (let i = nDays - 1; i >= 0; i--) {
		const oDate = new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate() - i);
		aBuckets.push({
			day: isoDay(oDate),
			label: dayLabel(oDate),
			error: 0,
			warning: 0,
			success: 0
		});
	}
	return aBuckets;
}

export async function loadLastDays(oModel: ODataModel, nDays: number): Promise<ChartData> {
	// Obergrenze der geladenen Zeilen. Bewusst lokal: die ESLint-Regel
	// sap-no-global-variable beanstandet Deklarationen auf Modulebene.
	const nMaxRows = 5000;
	const aBuckets = emptyBuckets(nDays);
	const mByDay = new Map<string, DayBucket>(aBuckets.map((o) => [o.day, o]));

	const oBinding = oModel.bindList("/AppLog", undefined, [], undefined, {
		$select: "CreatedAt,LogType",
		$filter: `CreatedAt ge ${aBuckets[0].day}`,
		$count: true
	});

	const aContexts = await oBinding.requestContexts(0, nMaxRows);

	aContexts.forEach((oContext) => {
		const oRow = oContext.getObject() as { CreatedAt?: string; LogType?: string } | undefined;
		if (!oRow?.CreatedAt) {
			return;
		}
		// Edm.Date kommt als "YYYY-MM-DD"; bei einem Zeitstempel den Tag abschneiden.
		const oBucket = mByDay.get(oRow.CreatedAt.slice(0, 10));
		if (!oBucket) {
			return;
		}
		switch (oRow.LogType) {
			case "E": oBucket.error++; break;
			case "W": oBucket.warning++; break;
			case "S": oBucket.success++; break;
			default: break;
		}
	});

	const nTotal = oBinding.getCount() ?? aContexts.length;

	return {
		days: aBuckets,
		truncated: nTotal > aContexts.length
	};
}
