import ThemeParameters from "sap/ui/core/theming/Parameters";

/**
 * Semantische Palette fuer das gestapelte Chart: rot / gelb / gruen.
 *
 * Die Farben kommen aus den Theme-Parametern statt als Hex-Literale, damit
 * sie zum aktiven Theme und zur Kritikalitaets-Darstellung in den Tabellen
 * passen (siehe model/formatter.ts). Die Reihenfolge entspricht der
 * Measure-Reihenfolge im Dataset: Fehler, Warnungen, Erfolg.
 *
 * ThemeParameters.get wird in der Objektform mit callback benutzt - die
 * synchronen Varianten (String bzw. Array als erstes Argument) sind seit
 * UI5 1.94 deprecated. Sind die CSS-Dateien schon geladen, liefert der
 * Aufruf direkt; sonst greift der callback nach.
 */

// Bewusst Funktionen statt modulweiter Konstanten: die ESLint-Regel
// sap-no-global-variable beanstandet jede Deklaration auf Modulebene,
// weil sie ES-Modul-Scope als globalen Scope behandelt.
function paramNames(): string[] {
	return ["sapUiNegative", "sapUiCritical", "sapUiPositive"];
}

/** Nur als Notnagel, falls das Theme keine Werte liefert. */
function fallback(): string[] {
	return ["#bb0000", "#e76500", "#188918"];
}

function toPalette(mValues: unknown): string[] {
	const aFallback = fallback();
	if (!mValues || typeof mValues !== "object") {
		return aFallback;
	}
	const mMap = mValues as Record<string, string | undefined>;
	return paramNames().map((sName, i) => mMap[sName] ?? aFallback[i]);
}

/**
 * Ruft fnApply mit den drei Farben auf - je nach Theme-Ladezustand
 * sofort oder nachtraeglich.
 */
export function resolvePalette(fnApply: (aColors: string[]) => void): void {
	const vDirect = ThemeParameters.get({
		name: paramNames(),
		callback: (vAsync: unknown) => { fnApply(toPalette(vAsync)); }
	});

	if (vDirect) {
		fnApply(toPalette(vDirect));
	}
}
