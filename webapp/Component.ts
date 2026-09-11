import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import Device from "sap/ui/Device";
import * as ProcessAxis from "./model/ProcessAxis";
import * as ViewDefaults from "./model/ViewDefaults";
import * as ThemeState from "./util/ThemeState";
import * as AutoRefreshState from "./util/AutoRefreshState";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";

/**
 * @namespace zui5_zle_aust_mon
 */
export default class Component extends UIComponent {

	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"]
	};

	public init(): void {
		super.init();

		// Titel des Browser-Tabs aus dem i18n-Bundle.
		//
		// WARUM HIER UND NICHT NUR IN index.html
		// Es gibt zwei Einstiegspunkte: die deployte index.html und - lokal -
		// die von fiori-tools-preview GENERIERTE flp.html, die "Local FLP
		// Sandbox" heisst und sich nicht aendern laesst. Setzt die App den
		// Titel selbst, stimmt er in beiden Faellen, und er ist ausserdem
		// uebersetzbar statt fest verdrahtet.
		//
		// Der statische Titel in index.html bleibt als Anzeige VOR dem Start
		// von UI5 - sonst stuende dort waehrend des Ladens nichts.
		const oBundle = (this.getModel("i18n") as ResourceModel | undefined)
			?.getResourceBundle() as ResourceBundle | undefined;
		const sTitle = oBundle?.getText("appTitle");
		if (sTitle) {
			document.title = sTitle;
		}

		// Gemerktes Theme anwenden, BEVOR die View rendert - sonst blitzt beim
		// Start kurz das helle Theme auf. Ohne Merkung passiert nichts, dann
		// bleibt die Vorgabe aus dem Bootstrap gueltig.
		ThemeState.applyStored();

		this.setModel(new JSONModel(Device), "device");

		// Steuermodell der Oberflaeche.
		//
		// Die kpi-Struktur muss hier vollstaendig angelegt werden:
		// JSONModel.setProperty("/kpi/gesamt", ...) schlaegt still fehl, wenn
		// der Elternknoten /kpi noch nicht existiert - die Bindings blieben
		// dann leer und die Kacheln zeigten dauerhaft 0.
		//
		// selectedProcess/selectedType steuern den Reiter und den Typfilter
		// der Meldungssicht; die Reiter selbst kommen aus model/ProcessAxis.
		this.setModel(new JSONModel({
			lastRefreshText: "",
			// Reiterzustand der Meldungssicht. selectedType leer = alle Typen.
			selectedProcess: ProcessAxis.KEY_DEFAULT,
			selectedType: "",
			/*
			 * Tagesfilter der Vorgangssicht, ISO-Datum oder leer.
			 *
			 * Gesetzt wird er durch einen Klick im Verlauf oder ueber die
			 * Adresse (?dt=2026-09-11). Der Wert ist damit von Hand tippbar -
			 * _msgFilters( ) prueft ihn deshalb gegen ein Muster, bevor er in
			 * einen $filter geht.
			 */
			selectedDay: "",
			/*
			 * Werte der Spaltentrichter. Sie liegen im ui-Modell und nicht in
			 * der Tabellenbindung, weil sie SERVERSEITIG wirken - der
			 * eingebaute Spaltenfilter wuerde nur die geladenen 5000 Zeilen
			 * durchsuchen und bei einem Treffer dahinter faelschlich
			 * "nichts gefunden" melden.
			 */
			filterItem: "",
			filterTpa: "",
			filterMessage: "",
			// Sichtbare Fassung des Filterzustands, gebaut in
			// Main._syncFilterChips( ). Leeres Array statt undefined, damit
			// die Sichtbarkeitsbindung der Leiste beim ersten Rendern schon
			// eine Laenge hat.
			filterChips: [],
			// Beide auch hier, damit sie nie undefined sind - sie stehen in
			// der URL und werden von dort zurueckgeschrieben.
			searchTerm: "",
			// Filter "nur offene" der Vorgangssicht. Standard AUS: erst zeigen,
			// was da ist, dann eingrenzen lassen.
			openOnly: ViewDefaults.OPEN_ONLY_DEFAULT,
			// Dunkler Modus. Startwert aus dem gemerkten Theme, damit der Schalter
			// beim Laden schon richtig steht.
			darkMode: ThemeState.isDark(),
			// Reiter "Offene Punkte" ist ausgeblendet, nicht entfernt.
			// Route RouteTasks, Tasks.view.xml und der Zaehler bleiben
			// unveraendert - wer #/tasks direkt aufruft, landet weiterhin
			// dort. Auf true setzen, sobald der Reiter wieder gezeigt
			// werden soll.
			showTasks: false,
			// Selbsttaetiges Aktualisieren. Getrieben von einer Sonde, nicht von
			// einem blinden Timer - siehe model/ChangeProbe.ts.
			// Gemerkte Auswahl schlaegt die Voreinstellung. Hier und nicht im
			// Controller, damit der Takt gar nicht erst anlaeuft, wenn er
			// abgeschaltet war.
			autoRefresh: AutoRefreshState.read() ?? true,
			// String, weil SegmentedButton.selectedKey eine String-Eigenschaft
			// ist - siehe Kommentar in Main.controller.ts.
			chartDays: "7",
			chartTruncated: false,
			kpi: {
				gesamt: "0",
				offen: "0",
				fehler: "0",
				storniert: "0",
				tabIB: "0",
				tabOB: "0",
				tabITEM: "0",
				tabNONE: "0",
				tabALL: "0"
			},
			// Kopf des letzten Materialstammabgleichs (Punkt 38, Fall 4).
			//
			// 🔴 BEWUSST IM JSON-MODELL UND NICHT PER ODATA-ELEMENTBINDUNG.
			// Eine Bindung auf MatCompareRun('1') liefert 404, solange der
			// Report noch nie mit "Ergebnis fortschreiben" gelaufen ist - und
			// weil alle Startanfragen in EINEM $batch stecken, riss dieser
			// eine 404 am 09.09.2026 die komplette App mit runter: AppLog,
			// KPIs und Verlauf meldeten "previous request failed".
			//
			// Geladen wird deshalb im Controller ueber eine LISTEN-Bindung
			// auf die Menge: eine leere Menge liefert null Zeilen, keinen
			// Fehler. Fehlschlaege bleiben dort im try/catch, wie bei den
			// KPIs auch.
			matCmp: {
				runAt: "",
				cntSap: "0",
				cntHilis: "0",
				cntDiff: "0",
				cntOnlySap: "0",
				cntOnlyHil: "0",
				cntOk: "0",
				broken: false
			}
		}), "ui");

		this.getRouter().initialize();
	}
}
