import Theming from "sap/ui/core/Theming";

/**
 * Heller / dunkler Modus, gemerkt je Browser.
 *
 * WARUM UEBERHAUPT EIN SCHALTER
 * Die App laeuft eigenstaendig, ohne Launchpad - es gibt also keine
 * Benutzereinstellung, aus der das Theme kaeme. Ohne Schalter bekommt jeder
 * das, was im Bootstrap steht.
 *
 * WARUM localStorage
 * Dieselbe Begruendung wie bei util/TableColumnState.ts: kein
 * Personalisierungsdienst (sap.ushell) verfuegbar, flexEnabled ist false,
 * sap.ui.rta wurde mit dem OVP-Umbau entfernt. Gespeichert wird
 * ausschliesslich der Themenname, keine Geschaefts- oder Personendaten.
 *
 * ⚠ ANWENDEN GEHOERT IN Component.init( ), nicht in den Controller. Wird das
 * Theme erst beim Rendern der View gesetzt, sieht man den Wechsel als
 * Aufblitzen des hellen Themes.
 */

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const STORAGE_KEY = "zleTheme";

// Horizon ist das Theme der App (siehe ui5.yaml, flp.theme). Die dunkle
// Variante heisst genauso mit Suffix - kein anderes Theme, nur eine andere
// Auspraegung, deshalb bleiben alle Theme-Parameter gueltig.
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const THEME_LIGHT = "sap_horizon";
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const THEME_DARK = "sap_horizon_dark";

function read(): string | null {
	try {
		// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-localstorage -- s. Kommentar oben
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		// Privater Modus oder gesperrter Speicher: dann gilt die Voreinstellung.
		return null;
	}
}

function write(sTheme: string): void {
	try {
		// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-localstorage -- s. Kommentar oben
		localStorage.setItem(STORAGE_KEY, sTheme);
	} catch {
		// Auswahl gilt dann nur fuer diese Sitzung.
	}
}

/** true, wenn der gemerkte Modus dunkel ist. */
export function isDark(): boolean {
	return read() === THEME_DARK;
}

/**
 * Gemerkten Modus anwenden. Ohne Merkung passiert NICHTS - dann bleibt das
 * Theme aus dem Bootstrap gueltig, und wir ueberschreiben keine Vorgabe,
 * die im Betrieb vom ABAP-Server oder vom Launchpad kommt.
 */
export function applyStored(): void {
	const sStored = read();
	if (sStored === THEME_LIGHT || sStored === THEME_DARK) {
		Theming.setTheme(sStored);
	}
}

/** Umschalten und merken. */
export function apply(bDark: boolean): void {
	const sTheme = bDark ? THEME_DARK : THEME_LIGHT;
	write(sTheme);
	Theming.setTheme(sTheme);
}
