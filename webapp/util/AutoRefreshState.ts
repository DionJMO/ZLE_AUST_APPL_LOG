/**
 * Ein/Aus des Aktualisierungstakts, gemerkt je Browser.
 *
 * WARUM GEMERKT WIRD
 * Wer die selbsttaetige Aktualisierung wegen hoher Last abschaltet, will sie
 * beim naechsten Laden nicht wieder an haben. Vorher stand sie nach jedem
 * Neuladen erneut auf "an" - der Schalter wirkte dadurch folgenlos, gerade in
 * dem Fall, fuer den es ihn gibt.
 *
 * WARUM localStorage
 * Dieselbe Begruendung wie bei util/ThemeState.ts und
 * util/TableColumnState.ts: es gibt keinen Launchpad-Personalisierungsdienst
 * (sap.ushell), flexEnabled ist false, sap.ui.rta wurde mit dem OVP-Umbau
 * entfernt. Gespeichert wird ein einzelnes Ja/Nein - keine Geschaefts- oder
 * Personendaten.
 *
 * ⚠ GELESEN WIRD IN Component.init( ), nicht im Controller. Der Startwert muss
 * feststehen, BEVOR der Controller den Takt anwirft - sonst liefe erst eine
 * Runde an, die gleich wieder gestoppt wird.
 */

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const STORAGE_KEY = "zleAutoRefresh";

/**
 * Gemerkte Auswahl oder null, wenn nie eine getroffen wurde.
 *
 * ⚠ Der Unterschied zwischen null und false ist wesentlich: "nie entschieden"
 * muss die Voreinstellung gelten lassen, "bewusst aus" nicht. Ein Rueckgabetyp
 * boolean haette beides zu false verschmolzen und die Aktualisierung fuer
 * jeden neuen Benutzer abgeschaltet.
 */
export function read(): boolean | null {
	try {
		// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-localstorage -- s. Kommentar oben
		const sRaw = localStorage.getItem(STORAGE_KEY);
		return sRaw === null ? null : sRaw === "true";
	} catch {
		// Privater Modus oder gesperrter Speicher: dann gilt die Voreinstellung.
		return null;
	}
}

export function write(bOn: boolean): void {
	try {
		// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-localstorage -- s. Kommentar oben
		localStorage.setItem(STORAGE_KEY, String(bOn));
	} catch {
		// Auswahl gilt dann nur fuer diese Sitzung. Kein Grund zu stoeren.
	}
}
