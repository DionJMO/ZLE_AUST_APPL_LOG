import Button from "sap/m/Button";
import CheckBox from "sap/m/CheckBox";
import Dialog from "sap/m/Dialog";
import Label from "sap/m/Label";
import VBox from "sap/m/VBox";
import Column from "sap/ui/table/Column";
import Table from "sap/ui/table/Table";

/**
 * Spalten-Sichtbarkeit je Tabelle merken und per Dialog pflegen.
 *
 * Ersetzt die frueheren Component.ts-Methoden _openColumnDialog und den
 * localStorage-Teil von _initColumnPersonalization. Der Speicherschluessel
 * haengt jetzt an der stabilen View-ID der Tabelle statt an einer zur
 * Laufzeit erzeugten ID - dadurch ueberlebt die Auswahl ein Neuladen.
 *
 * sap.ui.table.Column hat kein getHeader(), sondern getLabel().
 *
 * ZUR SPEICHERUNG: Die Fiori-Regel sap-no-localstorage verlangt fuer
 * Personalisierung eigentlich den Launchpad-Personalisierungsdienst
 * (sap.ushell) oder UI5 Flexibility. Beides steht hier nicht zur
 * Verfuegung: die App laeuft eigenstaendig, sap.ui.rta wurde mit dem
 * OVP-Umbau entfernt und flexEnabled ist false. localStorage ist damit
 * die einzige verbleibende Ablage; es werden ausschliesslich
 * Sichtbarkeits-Flags gespeichert, keine Geschaefts- oder Personendaten.
 * Sollte die App spaeter fest ins Launchpad wandern, ist das hier die
 * Stelle, die auf den Personalisierungsdienst umzustellen ist.
 */

/**
 * Der Schluessel ist versioniert, weil writeSaved ein boolean[] nach
 * SPALTENINDEX ablegt. Wird der Spaltensatz einer Tabelle geaendert -
 * neue Spalte, andere Reihenfolge - zeigen gespeicherte Flags auf die
 * falschen Spalten, und der neue Standard aus DEFAULT_VISIBLE greift
 * bei jedem, der den Dialog schon einmal geoeffnet hat, gar nicht.
 *
 * Deshalb: bei jeder Aenderung am Spaltensatz die Version hochzaehlen.
 * v2 = 25.08.2026, HTTP-Status in der Abbruch-Tabelle ergaenzt.
 * v3 = 26.08.2026, Umbau auf Reiter - aus sechs Tabellen wurden zwei.
 */
function storageKey(sTableId: string): string {
	return "colVis_v3_" + sTableId;
}

function columnLabel(oColumn: Column, iIndex: number): string {
	const oLabel = oColumn.getLabel();
	if (oLabel instanceof Label) {
		return oLabel.getText();
	}
	return "Spalte " + String(iIndex + 1);
}

function readSaved(sTableId: string): boolean[] | null {
	try {
		// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-localstorage -- s. Kommentar oben
		const sRaw = localStorage.getItem(storageKey(sTableId));
		return JSON.parse(sRaw ?? "null") as boolean[] | null;
	} catch {
		return null;
	}
}

function writeSaved(sTableId: string, aVisible: boolean[]): void {
	try {
		// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-localstorage -- s. Kommentar oben
		localStorage.setItem(storageKey(sTableId), JSON.stringify(aVisible));
	} catch {
		// Privater Modus oder volles Kontingent: Auswahl gilt dann nur fuer
		// diese Sitzung. Kein Grund, die Oberflaeche zu stoeren.
	}
}

/**
 * Stellt eine gespeicherte Auswahl wieder her. Gibt es keine, sind die
 * ersten nDefaultVisible Spalten sichtbar und der Rest ausgeblendet.
 */
export function restore(oTable: Table, sTableId: string, nDefaultVisible: number): void {
	const aColumns = oTable.getColumns();
	const aSaved = readSaved(sTableId);

	aColumns.forEach((oColumn, i) => {
		if (aSaved) {
			if (aSaved[i] !== undefined) {
				oColumn.setVisible(aSaved[i]);
			}
		} else {
			oColumn.setVisible(i < nDefaultVisible);
		}
	});
}

/**
 * Oeffnet den Spaltenauswahl-Dialog und speichert die Auswahl.
 */
export function openDialog(oTable: Table, sTableId: string): void {
	const aColumns = oTable.getColumns();
	const aCheckBoxes = aColumns.map((oColumn, i) => new CheckBox({
		text: columnLabel(oColumn, i),
		selected: oColumn.getVisible()
	}));

	const oDialog = new Dialog({
		title: "Spalten konfigurieren",
		content: [new VBox({ items: aCheckBoxes })],
		beginButton: new Button({
			text: "OK",
			type: "Emphasized",
			press: () => {
				aColumns.forEach((oColumn, i) => { oColumn.setVisible(aCheckBoxes[i].getSelected()); });
				writeSaved(sTableId, aColumns.map((oColumn) => oColumn.getVisible()));
				oDialog.close();
			}
		}),
		endButton: new Button({
			text: "Abbrechen",
			press: () => { oDialog.close(); }
		}),
		afterClose: () => { oDialog.destroy(); }
	});

	oDialog.open();
}
