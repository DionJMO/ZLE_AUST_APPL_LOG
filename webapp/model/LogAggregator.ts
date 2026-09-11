import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Sorter from "sap/ui/model/Sorter";
import Filter from "sap/ui/model/Filter";

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
	/** Meldungen im Zeitfenster insgesamt - auch die nicht geladenen. */
	total: number;
	/** Wie viele davon ausgewertet wurden. */
	loaded: number;
	/**
	 * Der aelteste ausgewertete Zeitstempel. Nur gesetzt, wenn gekappt wurde -
	 * dann gilt der Verlauf erst AB diesem Zeitpunkt, und alle Tage davor sind
	 * unvollstaendig gezaehlt.
	 */
	cutAt: string;
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
 *
 * 🔴 DIE SORTIERUNG IST NICHT KOSMETIK, SIE ENTSCHEIDET UEBER RICHTIG ODER
 * FALSCH. Bis 11.09.2026 lief die Abfrage OHNE $orderby. Welche 5000 Zeilen
 * der Server dann liefert, ist beliebig - bei Ueberlauf waren die Balken also
 * nicht "gekuerzt", sondern hatten WILLKUERLICHE HOEHEN, und einen
 * Schnittzeitpunkt gab es nicht, weil es keine Ordnung gab. Die Oberflaeche
 * meldete dazu "Datenmenge gekuerzt" und erweckte damit den Eindruck, der
 * Rest stimme.
 *
 * Mit absteigendem Zeitstempel sind es "die neuesten 5000, Schnitt bei
 * cutAt" - eine Aussage, die man treffen und anzeigen kann. Die
 * Meldungstabelle macht es seit jeher so (_loadCascades).
 *
 * ⚠ Sortiert wird ueber CreatedAtStamp, NICHT ueber CreatedAt: das ist nur
 * ein Datum, und bei einem Schnitt mitten im Tag fiele wieder eine beliebige
 * Teilmenge dieses Tages heraus.
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

/**
 * @param aFilters Zusaetzliche Bedingungen aus der Meldungssicht - Prozess,
 *        Suche, "Nur offene". Damit zaehlt der Balken dieselbe Menge, die
 *        die Tabelle darunter zeigt; vorher zaehlte er ueber ALLE Reiter,
 *        und wer auf die 40 klickte, sah sechs Zeilen.
 *
 *        ⚠ OHNE Typ und OHNE Tag, und das ist keine Nachlaessigkeit: der
 *        Typ ist die eigene Achse dieses Diagramms (die Stapel E/W/S) -
 *        folgte es ihm, bliebe nach einem Klick nur noch eine Reihe uebrig.
 *        Und der Tag ist das, was man IM Diagramm auswaehlt; ein Verlauf,
 *        der sich auf den gewaehlten Tag zusammenzieht, waere kein Verlauf
 *        mehr.
 */
export async function loadLastDays(
	oModel: ODataModel,
	nDays: number,
	aFilters: Filter[] = []
): Promise<ChartData> {
	// Obergrenze der geladenen Zeilen. Bewusst lokal: die ESLint-Regel
	// sap-no-global-variable beanstandet Deklarationen auf Modulebene.
	const nMaxRows = 5000;
	const aBuckets = emptyBuckets(nDays);
	const mByDay = new Map<string, DayBucket>(aBuckets.map((o) => [o.day, o]));

	const oBinding = oModel.bindList("/AppLog", undefined,
		new Sorter("CreatedAtStamp", true), aFilters, {
			// CreatedAtStamp wird zusaetzlich selektiert, weil daraus der
			// Schnittzeitpunkt abgelesen wird. Sortieren allein braeuchte das
			// Feld nicht - anzeigen schon.
			$select: "CreatedAt,CreatedAtStamp,LogType",
			$filter: `CreatedAt ge ${aBuckets[0].day}`,
			$count: true
		});

	const aContexts = await oBinding.requestContexts(0, nMaxRows);

	let sOldest = "";
	aContexts.forEach((oContext) => {
		const oRow = oContext.getObject() as
			{ CreatedAt?: string; CreatedAtStamp?: string; LogType?: string } | undefined;
		if (!oRow?.CreatedAt) {
			return;
		}
		// Absteigend sortiert - der zuletzt gelesene Satz ist der aelteste.
		sOldest = oRow.CreatedAtStamp ?? sOldest;
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
	const bTruncated = nTotal > aContexts.length;

	return {
		days: aBuckets,
		truncated: bTruncated,
		total: nTotal,
		loaded: aContexts.length,
		// Nur bei Ueberlauf. Ohne Kappung gibt es keinen Schnitt, und ein
		// Zeitstempel daneben behauptete eine Grenze, die es nicht gibt.
		cutAt: bTruncated ? sOldest : ""
	};
}
