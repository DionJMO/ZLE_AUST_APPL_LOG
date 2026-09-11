import JSONModel from "sap/ui/model/json/JSONModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import * as LogTypeAxis from "./LogTypeAxis";
import { dateText } from "./formatter";

/**
 * Der gesetzte Filterzustand als Liste loeschbarer Marken.
 *
 * 🔴 WARUM ES DAS GIBT: „das man aber in der Tabellenuebersicht sieht was
 * man als letztes gefiltert hat". Der Zustand war ueber vier Bedienelemente
 * verteilt - Reiter, Segmentknopf, Suchfeld, Schalter -, und nach einem
 * Absprung aus dem Verlauf kam ein fuenfter dazu, der ueberhaupt kein
 * eigenes Bedienelement hat: der Tag. Die Tabelle aenderte sich also, ohne
 * dass irgendwo stand warum.
 *
 * ⚠ BEWUSST NICHT ALLES WIRD ZUR MARKE:
 *   Prozess     ist der REITER und dort sichtbar - eine Marke daneben waere
 *               dieselbe Angabe zweimal.
 *   "Nur offene" zeigt seinen Zustand als STELLUNG des Schalters. Auch hier
 *               waere die Marke eine Verdopplung.
 * Eine Marke bekommt, was sonst unsichtbar bleibt.
 *
 * Aufteilung wie in ProcessAxis und MessageText: die Regel steht hier, der
 * Wortlaut in i18n.
 */

export interface Chip {
	/** Stabiler Bezeichner - die Loeschgeste gibt ihn zurueck. */
	id: string;
	text: string;
}

/**
 * Welcher Modellpfad haengt an welcher Marke, und was ist sein Leerwert.
 *
 * Als Tabelle und nicht als switch, damit Aufbauen und Loeschen zwingend
 * dieselbe Liste benutzen. Eine Marke, die sich nicht loeschen laesst, waere
 * schlimmer als keine.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const PATHS: Record<string, string> = {
	type: "/selectedType",
	day: "/selectedDay",
	search: "/searchTerm",
	// Die Spaltentrichter. Sie brauchen die Marke am dringendsten: ihr
	// Zustand steht sonst NUR als kleines Trichtersymbol in der
	// Spaltenueberschrift, und wer die Spalte ausblendet oder wegscrollt,
	// sieht gar nichts mehr davon.
	item: "/filterItem",
	tpa: "/filterTpa",
	message: "/filterMessage"
};

/**
 * Marken, deren Text nur "Beschriftung: Wert" ist - der Regelfall.
 *
 * Als Tabelle, damit eine neue Trichterspalte hier eine Zeile ist und nicht
 * ein weiterer if-Block unten.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const SIMPLE: { id: string; key: string }[] = [
	{ id: "search", key: "chipSearch" },
	{ id: "item", key: "chipItem" },
	{ id: "tpa", key: "chipTpa" },
	{ id: "message", key: "chipMessage" }
];

/** Die Marken zum aktuellen Zustand des ui-Modells. */
export function build(oUi: JSONModel, oBundle: ResourceBundle): Chip[] {
	const aChips: Chip[] = [];

	const sType = ((oUi.getProperty(PATHS.type) as string) ?? "").trim();
	if (sType) {
		aChips.push({
			id: "type",
			text: oBundle.getText("chipType", [LogTypeAxis.label(sType, oBundle)]) ?? ""
		});
	}

	const sDay = ((oUi.getProperty(PATHS.day) as string) ?? "").trim();
	if (sDay) {
		// In deutscher Schreibweise, wie ueberall sonst - der Anwender hat
		// auf "11.09." im Verlauf geklickt, nicht auf "2026-09-11".
		aChips.push({ id: "day", text: oBundle.getText("chipDay", [dateText(sDay)]) ?? "" });
	}

	SIMPLE.forEach((oDefinition) => {
		const sValue = ((oUi.getProperty(PATHS[oDefinition.id]) as string) ?? "").trim();
		if (sValue) {
			aChips.push({
				id: oDefinition.id,
				text: oBundle.getText(oDefinition.key, [sValue]) ?? ""
			});
		}
	});

	return aChips;
}

/**
 * Eine Marke entfernen - setzt ihren Modellpfad zurueck.
 *
 * Liefert true, wenn tatsaechlich etwas geaendert wurde. Der Aufrufer laedt
 * nur dann neu; eine unbekannte Marke loest sonst einen Ladevorgang fuer
 * nichts aus.
 */
export function clear(oUi: JSONModel, sChipId: string): boolean {
	const sPath = PATHS[sChipId];
	if (!sPath) {
		return false;
	}
	oUi.setProperty(sPath, "");
	return true;
}

/** Alle Marken entfernen. */
export function clearAll(oUi: JSONModel): void {
	Object.values(PATHS).forEach((sPath) => {
		oUi.setProperty(sPath, "");
	});
}
