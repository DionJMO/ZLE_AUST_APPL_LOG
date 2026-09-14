import UIComponent from "sap/ui/core/UIComponent";
import Table from "sap/ui/table/Table";
import JSONModel from "sap/ui/model/json/JSONModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Event from "sap/ui/base/Event";
import VizFrame from "sap/viz/ui5/controls/VizFrame";
import BaseController from "./BaseController";
import * as TableColumnState from "../util/TableColumnState";
import * as ThemeState from "../util/ThemeState";
import * as AutoRefreshState from "../util/AutoRefreshState";
import Theming from "sap/ui/core/Theming";
import * as LogAggregator from "../model/LogAggregator";
import * as KpiLoader from "../model/KpiLoader";
import * as ChartColors from "../model/ChartColors";
import * as MessageText from "../model/MessageText";
import * as ProcessAxis from "../model/ProcessAxis";
import * as LogTypeAxis from "../model/LogTypeAxis";
import * as FilterChips from "../model/FilterChips";
import * as KeyDetailLoader from "../model/KeyDetailLoader";
import * as CascadeGrouper from "../model/CascadeGrouper";
import * as ViewDefaults from "../model/ViewDefaults";
import * as SapLookup from "../model/SapLookup";
import * as TaPositions from "../model/TaPositions";
import * as ReprocLookup from "../model/ReprocLookup";
import * as BusinessKey from "../model/BusinessKey";
import { normalizeMaterial as formatterNormalize, timestamp as formatterTimestamp } from "../model/formatter";
import Sorter from "sap/ui/model/Sorter";
import Fragment from "sap/ui/core/Fragment";
import Popover from "sap/m/Popover";
import Dialog from "sap/m/Dialog";
import Control from "sap/ui/core/Control";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import MessageToast from "sap/m/MessageToast";
import MessageBox from "sap/m/MessageBox";

/**
 * @namespace zui5_zle_aust_mon.controller
 */
export default class Main extends BaseController {

	/**
	 * Standardmaessig sichtbare Spaltenanzahl je Tabelle. Der Rest ist
	 * ausgeblendet und laesst sich ueber das Zahnrad einblenden.
	 *
	 * Seit dem Umbau auf Reiter gibt es nur noch zwei Tabellen: eine fuer
	 * alle Meldungsreiter und eine fuer die Auftraege.
	 */
	/**
	 * Tabellen, die beim Aktualisieren NEU GELESEN werden muessen.
	 *
	 * 🔴 Bewusst eine eigene Liste und NICHT Object.keys( DEFAULT_VISIBLE ).
	 * Die beiden Mengen fielen bisher nur zufaellig zusammen: DEFAULT_VISIBLE
	 * sagt "welche Tabelle hat einen Spaltendialog", diese Liste sagt "welche
	 * Tabelle haengt an OData und muss neu gelesen werden". Mit dem
	 * Arbeitsvorrat fallen sie auseinander - er hat sieben feste Spalten und
	 * keine Personalisierung, muss aber erneuert werden.
	 *
	 * ⚠ Ihn in DEFAULT_VISIBLE einzutragen waere der naheliegende, falsche
	 * Fix: das schaltete fuer ihn den Spaltendialog frei und liesse restore( )
	 * ueber seine festen Spalten laufen.
	 *
	 * ℹ Nicht enthalten sind die JSON-gebundenen Tabellen: idCascadeTable
	 * (ueber _applyMsgFilter) und idWaCheckTable (ueber _loadShadowedPicks in
	 * _loadData). Ein refresh( ) auf einer JSON-Bindung tut nichts - genau
	 * daran hing der Fehler, den Joerg am 01.09. gemeldet hat.
	 */
	private static readonly REFRESH_TABLES = ["idTpaTable"];

	private static readonly DEFAULT_VISIBLE: Record<string, number> = {
		idTpaTable: 8
	};

	/** Detail-Popover und Payload-Dialog werden einmal erzeugt und wiederverwendet. */
	private _pKeyPopover?: Promise<Popover>;

	/** Hinweis-Popover der Kopfzeile, einmalig erzeugt. */
	private _pInfoPopover?: Promise<Popover>;

	/** Arbeitsvorrats-Popover, einmalig erzeugt. */
	private _pReprocPopover?: Promise<Popover>;
	private _pPayloadDialog?: Promise<Dialog>;

	/**
	 * Takt des selbsttaetigen Aktualisierens in Millisekunden.
	 *
	 * KEINE AENDERUNGSSONDE - und der Grund gehoert hierher, damit sie nicht
	 * wieder eingebaut wird. Ein erster Entwurf prueft per $count, OB es neue
	 * Zeilen gibt. Der Einwand trifft: fuer diese Pruefung laeuft ebenfalls
	 * ein Intervall, die Zahl der Takte ist also identisch. Gespart haette
	 * man nur die Nutzlast je Takt - und das UI5-V4-Modell buendelt die
	 * Abfragen ohnehin zu einem $batch.
	 *
	 * 30 Sekunden und VOLLER Refresh: Festlegung 31.08.2026. Bewusst kurz,
	 * damit die Sicht praktisch mitlaeuft.
	 *
	 * ⚠ Was das kostet, damit es niemand spaeter sucht: je Takt laufen auch
	 * _loadShadowedPicks( ) (Vollstaendigkeitspruefung ueber 30 TAGE, mit
	 * Lookup-Service) und _loadChart( ) (bis zu 5000 Rohzeilen, weil der
	 * View kein $apply anbietet). Zwei Takte pro Minute. Gedeckelt wird das
	 * durch drei Dinge: den versteckten Tab, eine offene Detailsicht und die
	 * Ueberlappungssperre unten.
	 *
	 * Wer das guenstiger haben will, setzt NICHT das Intervall hoch, sondern
	 * O-21 um (Aggregations-View bzw. @Aggregation.applySupported). Dann
	 * zaehlt der Verlauf serverseitig und der teuerste Posten entfaellt.
	 */
	private static readonly AUTO_REFRESH_MS = 30000;

	/** Laufender Takt; undefined heisst: nicht aktiv. */
	private _iAuto?: number;

	/**
	 * Sperre gegen sich ueberlappende Takte.
	 *
	 * Ein voller Refresh kann laenger dauern als 30 Sekunden - die
	 * 30-Tage-Pruefung samt Lookups ist nicht schnell. Ohne diese Sperre
	 * wuerden sich die Laeufe stapeln, und zwar genau dann, wenn das System
	 * ohnehin langsam ist. setInterval fragt nicht, ob der Vorgaenger fertig
	 * ist.
	 */
	private _bAutoBusy = false;

	/** Angemeldeter visibilitychange-Zuhoerer, fuer onExit. */
	private _fnVisibility?: () => void;

	/** Voreinstellung des Verlaufs-Zeitfensters in Tagen. */
	private static readonly CHART_DAYS = 7;

	/**
	 * Zeitfenster der Vollstaendigkeitspruefung Warenausgang.
	 *
	 * Bewusst laenger als das Verlaufsfenster: der Befund, um den es geht,
	 * blieb im August zwei Wochen unbemerkt. Ein Fenster von sieben Tagen
	 * haette ihn wieder verpasst.
	 */
	private static readonly WA_CHECK_DAYS = 30;

	/**
	 * Die Sicht als URL: Reiter, Typfilter, Suche, Gruppierung.
	 *
	 * Zweck ist weniger das Ueberleben eines Neuladens als das VERSCHICKEN -
	 * "schau dir mal das an" ist in einem Werkzeug, das zwischen drei Leuten
	 * hin und her geht, mehr wert als es klingt.
	 *
	 * ⚠ Kurze Schluessel, weil sie in der Adresszeile stehen und dort auch
	 * von Hand gelesen und getippt werden.
	 */
	/** Schluessel aus URL_KEYS, die als "1"/"0" statt als Text zu lesen sind. */
	private static readonly URL_BOOLEANS: string[] = ["/openOnly"];

	private static readonly URL_KEYS = {
		p: "/selectedProcess",
		t: "/selectedType",
		q: "/searchTerm",
		o: "/openOnly",
		d: "/chartDays",
		// "dt" und nicht "d": das ist mit dem Zeitfenster des Verlaufs
		// belegt. Zwei Zeichen brechen das Kurzschluessel-Prinzip nicht.
		dt: "/selectedDay"
	};

	/**
	 * Sperre gegen Rueckkopplung Modell -> URL.
	 *
	 * ⚠ Startwert TRUE, und das ist kein Versehen. onInit laeuft VOR dem
	 * ersten patternMatched und ruft _applyMsgFilter( ). Duerfte der dabei
	 * schon die URL schreiben, ueberschriebe der Standardzustand eine
	 * mitgegebene Adresse - wer einen Link mit ?p=OB&t=E oeffnet, landete
	 * beim Standardreiter. Erst der erste Routentreffer gibt frei.
	 */
	private _bApplyingUrl = true;

	/**
	 * Laufende Nummer des Filterstands.
	 *
	 * Erhoeht sich bei jedem _applyMsgFilter( ). Beide Lader stempeln ihr
	 * Ergebnis damit, und verglichen wird nur bei gleicher Nummer - sonst
	 * stellt man Zahlen aus zwei verschiedenen Zustaenden gegeneinander.
	 */
	private _iFilterGen = 0;

	public onInit(): void {
		this.getView()?.setModel(new JSONModel({ days: [] }), "chart");

		// Wortlaut der sprechenden Meldungstexte einmal aufloesen. Muss VOR
		// dem ersten Rendern passieren, sonst greift der Formatter noch auf
		// einen leeren Cache und zeigt den Originaltext.
		MessageText.init(this._bundle());

		// Pfeilfunktion statt Methodenreferenz plus Listener-Kontext: eine
		// losgeloeste Methode traegt ihr "this" nicht mit, und ESLint weist
		// mit unbound-method zu Recht darauf hin.
		(this.getOwnerComponent() as UIComponent).getRouter()
			.getRoute("RouteMain")?.attachPatternMatched((oEvent: Event) => {
				this._onRouteMatched(oEvent);
			});

		Object.keys(Main.DEFAULT_VISIBLE).forEach((sTableId) => {
			const oTable = this._table(sTableId);
			if (oTable) {
				TableColumnState.restore(oTable, sTableId, Main.DEFAULT_VISIBLE[sTableId]);
			}
		});

		this._applyChartProperties();
		// Nach jedem Themenwechsel die Palette neu aus den Theme-Parametern
		// holen. Ein Handler genuegt - er laeuft auch beim ersten Anwenden.
		Theming.attachApplied(() => {
			this._applyChartProperties();
		});
		this._applyMsgFilter();
		void this._loadData();

		// Bei verstecktem Tab wird nicht gesondet. Das ist der wichtigste der
		// Waechter: ein vergessener Hintergrund-Tab wuerde sonst die ganze
		// Nacht abfragen. Beim Zurueckkehren gleich ein Takt, damit man nicht
		// auf das naechste Intervall wartet.
		this._fnVisibility = () => {
			if (!document.hidden && this.getUiModel().getProperty("/autoRefresh")) {
				void this._autoTick();
			}
		};
		document.addEventListener("visibilitychange", this._fnVisibility);

		this._syncAuto();
	}

	/** Timer und Zuhoerer abraeumen - sonst laufen sie nach dem Wechsel
	 *  auf #/tasks weiter. */
	public onExit(): void {
		this._stopAuto();
		if (this._fnVisibility) {
			document.removeEventListener("visibilitychange", this._fnVisibility);
			this._fnVisibility = undefined;
		}
	}

	/**
	 * Heller / dunkler Modus.
	 *
	 * Die Chart-Palette muss NACHGEZOGEN werden: sie kommt aus den
	 * Theme-Parametern (sapUiNegative/Critical/Positive) und wird in
	 * _applyChartProperties( ) EINMAL beim Start gelesen. Ohne das
	 * Nachziehen behielte das Diagramm nach dem Umschalten die Farben des
	 * alten Themes - auf dunklem Grund gut sichtbar falsch.
	 *
	 * Theming.attachApplied feuert, sobald die CSS-Dateien des neuen Themes
	 * geladen sind; vorher lieferten die Parameter noch die alten Werte.
	 */
	public onDarkModeToggle(): void {
		const bDark = this.getUiModel().getProperty("/darkMode") as boolean;
		ThemeState.apply(bDark);
	}

	/** Schalter in der Kopfzeile. */
	public onAutoRefreshToggle(oEvent: Event): void {
		const bOn = oEvent.getParameter("state" as never) as unknown as boolean;
		this.getUiModel().setProperty("/autoRefresh", bOn);
		AutoRefreshState.write(bOn);
		this._syncAuto();
	}

	private _syncAuto(): void {
		if (this.getUiModel().getProperty("/autoRefresh")) {
			this._startAuto();
		} else {
			this._stopAuto();
		}
	}

	private _startAuto(): void {
		if (this._iAuto !== undefined) {
			return;
		}
		this._iAuto = window.setInterval(() => {
			void this._autoTick();
		}, Main.AUTO_REFRESH_MS);
	}

	private _stopAuto(): void {
		if (this._iAuto !== undefined) {
			window.clearInterval(this._iAuto);
			this._iAuto = undefined;
		}
	}

	/**
	 * Ein Takt des selbsttaetigen Aktualisierens - VOLLER Refresh.
	 *
	 * Identisch zum Aktualisieren-Knopf, nur ohne Klick. Uebersprungen wird
	 * bei verstecktem Tab, bei offener Detailsicht und solange der
	 * vorherige Takt noch laeuft.
	 */
	private async _autoTick(): Promise<void> {
		if (document.hidden || this._bAutoBusy) {
			return;
		}
		if (await this._isOverlayOpen()) {
			return;
		}
		this._bAutoBusy = true;
		try {
			this._applyMsgFilter();
			Main.REFRESH_TABLES.forEach((sTableId) => {
				this._table(sTableId)?.getBinding("rows")?.refresh();
			});
			await this._loadData();
		} finally {
			this._bAutoBusy = false;
		}
	}

	/**
	 * Ist eine Detailsicht offen? Dann wird nicht aktualisiert - sonst wird
	 * dem Anwender der Inhalt unter den Haenden neu geladen.
	 *
	 * Die Promises entstehen erst bei der ersten Benutzung; im Normalfall
	 * sind beide undefined und die Pruefung kostet nichts.
	 */
	private async _isOverlayOpen(): Promise<boolean> {
		if (this._pKeyPopover) {
			if ((await this._pKeyPopover).isOpen()) {
				return true;
			}
		}
		if (this._pPayloadDialog) {
			if ((await this._pPayloadDialog).isOpen()) {
				return true;
			}
		}
		return false;
	}

	public onRefresh(): void {
		// In der Vorgangssicht haengt die Tabelle am JSON-Modell "cascade" -
		// ein refresh( ) auf dieser Bindung tut nichts. Die Verdichtung muss
		// neu berechnet werden, und das macht _applyMsgFilter( ).
		//
		// ⚠ Das galt auch schon fuer den Aktualisieren-KNOPF: der hat die
		// Vorgangsliste bisher nicht erneuert, nur Kennzahlen und Verlauf.
		this._applyMsgFilter();
		Main.REFRESH_TABLES.forEach((sTableId) => {
			this._table(sTableId)?.getBinding("rows")?.refresh();
		});
		void this._loadData();
	}

	/**
	 * Wechsel in die Arbeitsliste des Fachbereichs. Bewusst nur in diese
	 * Richtung: wer aus dem Fachbereich kommt, startet direkt auf #/tasks
	 * und soll die technische Sicht gar nicht erst sehen. Zurueck geht es
	 * ueber den Browser.
	 */
	public onNavToTasks(): void {
		(this.getOwnerComponent() as UIComponent).getRouter().navTo("RouteTasks");
	}

	/**
	 * Der Reiterschluessel wird aus dem Ereignis gelesen, nicht aus dem
	 * Modell: ob die Zwei-Wege-Bindung von selectedKey vor dem select-
	 * Ereignis greift, ist nicht garantiert.
	 */
	public onProcessTabSelect(oEvent: Event): void {
		const sKey = oEvent.getParameter("key" as never) as unknown as string;
		this.getUiModel().setProperty("/selectedProcess", sKey);
		// Prozess/Suche/"Nur offene" gelten auch fuer den Verlauf.
		this._applyMsgFilter(true);
	}

	/**
	 * Arbeitsvorrat zu einem Business-Key oeffnen.
	 *
	 * Ersetzt den Reiter "Arbeitsvorrat" (bis 02.09.2026). Die Spalte zeigt
	 * nur die Zusammenfassung; welche Aktion angestossen wird, entscheidet
	 * der Anwender hier - zu einem Business-Key koennen mehrere Saetze
	 * gehoeren, und die Logzeile traegt keine Aktion.
	 */
	public async onReprocPress(oEvent: Event): Promise<void> {
		// ESLint irrt, tsc braucht die Assertion - gleiche begruendete
		// Ausnahme wie bei den uebrigen Zellen-Handlern.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		const sKey = String(oSource.getBindingContext("cascade")?.getProperty("BusinessKey") ?? "").trim();

		/*
		 * 🔴 KEIN FRUEHER AUSSTIEG MEHR. Bis 11.09.2026 kehrte die Methode bei
		 * leerem Schluessel wortlos um - zusammen mit der bedingten
		 * Klickbarkeit war das die Rueckmeldung "Funktion ist kaputt": in drei
		 * verschiedenen Lagen (kein Schluessel, kein Satz, Arbeitsvorrat nicht
		 * lesbar) passierte dasselbe, naemlich nichts.
		 *
		 * Jetzt oeffnet sich das Popover immer und sagt, welche der drei Lagen
		 * vorliegt.
		 */
		const oBundle = this._bundle();
		const oModel = this._jsonModel("reproc", { map: {} });
		const oMap = (oModel.getProperty("/map") ?? {}) as Record<string, ReprocLookup.ReprocEntry[]>;
		const oDone = (oModel.getProperty("/mapDone") ?? {}) as Record<string, ReprocLookup.ReprocEntry[]>;
		const aEntries = sKey ? (oMap[sKey] ?? []) : [];
		const aDone = sKey ? (oDone[sKey] ?? []) : [];

		oModel.setProperty("/entries", aEntries);
		oModel.setProperty("/done", aDone);
		oModel.setProperty("/title", sKey
			? (oBundle.getText("reprocPopTitle", [sKey]) ?? sKey)
			: (oBundle.getText("reprocPopTitleNoKey") ?? ""));
		oModel.setProperty("/hint", this._reprocHint(sKey, aEntries.length + aDone.length, oModel));

		if (!this._pReprocPopover) {
			this._pReprocPopover = Fragment.load({
				id: this.getView()?.getId(),
				name: "zui5_zle_aust_mon.view.fragment.ReprocPopover",
				controller: this
			}) as Promise<Popover>;
			void this._pReprocPopover.then((oPopover) => this.getView()?.addDependent(oPopover));
		}
		(await this._pReprocPopover).openBy(oSource);
	}

	/**
	 * Warum steht in diesem Popover (fast) nichts?
	 *
	 * Drei Lagen, und sie sind fachlich verschieden - deshalb drei Saetze und
	 * nicht einer. Genau diese Unterscheidung fehlte, als "es passiert
	 * nichts" gemeldet wurde:
	 *
	 *   nicht lesbar    der Arbeitsvorrats-Service hat nicht geantwortet.
	 *                   Das ist ein STOERUNGSFALL und muss als solcher
	 *                   dastehen - er sah bisher aus wie Ruhe.
	 *   kein Schluessel die Meldung traegt keinen BUSINESS_KEY (Michaels
	 *                   P17). Ohne ihn gibt es keinen Vorgang, an dem ein
	 *                   Wiederanstoss haengen koennte.
	 *   kein Satz       alles in Ordnung, es steht nur nichts an. Ein Satz
	 *                   entsteht erst, wenn ein Trigger ihn registriert.
	 */
	private _reprocHint(sKey: string, nEntries: number, oModel: JSONModel): string {
		const oBundle = this._bundle();
		if (oModel.getProperty("/ok") !== true) {
			const sError = ((oModel.getProperty("/error") as string) ?? "").trim();
			return (oBundle.getText("reprocUnavailable", [sError]) ?? "").trim();
		}
		if (!sKey) {
			return oBundle.getText("reprocNoKey") ?? "";
		}
		return nEntries === 0 ? (oBundle.getText("reprocPopNoneHint") ?? "") : "";
	}

	public onReprocClose(): void {
		void this._pReprocPopover?.then((oPopover) => oPopover.close());
	}

	/**
	 * Einen Satz des Arbeitsvorrats erneut anstossen.
	 *
	 * Ruft die RAP-Aktion Retry auf ZLE_AUST_C_REPROC, und die ruft im
	 * Backend ZCL_ZLE_AUST_REPROC_DISP=>RUN_ONE. Bewusst NICHT RESEND_TO oder
	 * CANCEL_LINES direkt: der Dispatcher erledigt Customizing-Ermittlung,
	 * Versuchszaehler, REGISTER vor und CONFIRM bzw. FAIL nach dem Aufruf.
	 * Der Report ZLE_AUST_RESEND ueberspringt genau diese Buchfuehrung.
	 *
	 * 🔴 Der Kontext wird ueber den SCHLUESSELPFAD gebaut, nicht aus einer
	 * Listenbindung genommen - die Zeilen stehen in einem JSON-Modell, nicht
	 * in einer OData-Bindung. Der Pfad traegt beide Schluesselfelder, weil
	 * ZLE_AUST_REPROC auf ACTION + BUSINESS_KEY schluesselt.
	 * ⚠ Die Werte werden nicht maskiert: Aktionscodes und Business-Keys sind
	 * alphanumerisch mit Unterstrich. Kaeme je ein Hochkomma vor, muesste es
	 * nach OData-Regel verdoppelt werden.
	 *
	 * ⚠ Der Aufruf ist ein POST und dauert, weil das Backend synchron mit
	 * HiLIS spricht - deshalb wird der Knopf fuer die Dauer auf busy gesetzt.
	 * Ohne das klickt jemand zweimal, und dann laufen zwei HiLIS-Aufrufe (der
	 * LOCK-Handler im Backend ist bewusst leer, s. REPROC_0_README).
	 */
	public async onReprocRetryPress(oEvent: Event): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		const oCtx = oSource.getBindingContext("reproc");
		const sAction = String(oCtx?.getProperty("Action") ?? "").trim();
		const sKey = String(oCtx?.getProperty("BusinessKey") ?? "").trim();
		if (!sAction || !sKey) {
			return;
		}

		const oBundle = this._bundle();
		oSource.setBusy(true);
		try {
			const oModel = this.getODataModel("reprocModel");
			const sNamespace = await this._actionNamespace(oModel);
			const oEntity = oModel.bindContext(
				`/Reproc(Action='${sAction}',BusinessKey='${sKey}')`
			).getBoundContext();
			await oModel.bindContext(`${sNamespace}.Retry(...)`, oEntity).execute();
			MessageToast.show(oBundle.getText("retryDone") ?? "");
		} catch (oError) {
			// eslint-disable-next-line no-console
			console.error("[Arbeitsvorrat] Wiederanstoss fehlgeschlagen:", oError);
			MessageBox.error(oBundle.getText("retryFailed") ?? "", {
				details: (oError as Error)?.message ?? ""
			});
		} finally {
			oSource.setBusy(false);
		}

		// Nachziehen, damit man das Ergebnis im offenen Popover sieht: neuer
		// Status, hochgezaehlter Versuch, neue Meldung. Ist der Satz danach
		// erledigt, verschwindet er aus dem Nachschlagewerk und die Liste
		// wird leer - das IST die Bestaetigung.
		await this._loadReprocMap();
		const oJson = this._jsonModel("reproc", { map: {} });
		const oNew = (oJson.getProperty("/map") ?? {}) as Record<string, ReprocLookup.ReprocEntry[]>;
		const oNewDone = (oJson.getProperty("/mapDone") ?? {}) as Record<string, ReprocLookup.ReprocEntry[]>;
		const aEntries = oNew[sKey] ?? [];
		const aDone = oNewDone[sKey] ?? [];
		oJson.setProperty("/entries", aEntries);
		// Der erledigte Satz erscheint jetzt unten statt spurlos zu
		// verschwinden - DAS ist die Bestaetigung, dass es gewirkt hat.
		oJson.setProperty("/done", aDone);
		oJson.setProperty("/hint", this._reprocHint(sKey, aEntries.length + aDone.length, oJson));
	}

	/**
	 * Volltextsuche ueber die Meldungstabelle.
	 *
	 * ⚠ Bewusst nur am search-Ereignis (Eingabetaste, Lupe, Loeschkreuz) und
	 * NICHT an liveChange: bei ueber 6000 Saetzen wuerde jeder Tastendruck
	 * eine OData-Abfrage ausloesen.
	 */
	/**
	 * Zeitfenster des Verlaufs umschalten.
	 *
	 * ⚠ Nur der Chart wird neu geladen, nicht die Kennzahlen: die zaehlen
	 * bewusst ueber ALLE Zeiten und haben mit dem Fenster nichts zu tun.
	 * Ein _loadData( ) hier waere drei Abfragen fuer nichts.
	 */
	public onChartDaysChange(oEvent: Event): void {
		const oItem = oEvent.getParameter("item" as never) as unknown as { getKey(): string };
		this.getUiModel().setProperty("/chartDays", oItem.getKey());
		this._syncUrl();
		void this._loadChart();
	}

	public onMsgSearch(oEvent: Event): void {
		const sQuery = (oEvent.getParameter("query" as never) as unknown as string) ?? "";
		this.getUiModel().setProperty("/searchTerm", sQuery.trim());
		// Prozess/Suche/"Nur offene" gelten auch fuer den Verlauf.
		this._applyMsgFilter(true);
	}

	public onTypeFilterChange(oEvent: Event): void {
		const oItem = oEvent.getParameter("item" as never) as unknown as { getKey(): string };
		this.getUiModel().setProperty("/selectedType", oItem.getKey());
		this._applyMsgFilter();
	}

	/** Ein Zahnrad fuer beide Tabellen - je nachdem, welcher Reiter offen ist. */
	public onOpenMsgColumns(): void {
		// Nur der Auftragspuffer hat noch eine Spaltenauswahl. Vorgangssicht
		// und WA-Pruefung haben feste, wenige Spalten - eine Auswahl waere
		// Ballast. Der Knopf ist deshalb auch nur am Auftragsreiter sichtbar.
		if ((this.getUiModel().getProperty("/selectedProcess") as string) !== ProcessAxis.KEY_ORDERS) {
			return;
		}
		this._openColumns("idTpaTable");
	}

	/**
	 * Setzt Prozess- und Typfilter auf die Meldungstabelle.
	 *
	 * Der Reiter "Alle Meldungen" bleibt bewusst ungefiltert und ist damit
	 * eine Obermenge der uebrigen - er ist keine Kategorie, sondern die
	 * Rohsicht fuer die Fehlersuche. Wer die Reiterzahlen addiert, kommt
	 * deshalb nicht auf diese Zahl.
	 */
	/**
	 * @param bReloadChart Auch den Verlauf neu laden.
	 *
	 * ⚠ NICHT IMMER, und das ist Absicht. Der Verlauf folgt Prozess, Suche
	 * und "Nur offene" - nur die drei Handler, die daran etwas aendern,
	 * setzen das Kennzeichen. Ein Typ- oder Tagesklick aendert den Verlauf
	 * nicht (beides sind seine eigenen Achsen), und der 30-Sekunden-Takt
	 * laedt ihn ohnehin ueber _loadData( ) - dort noch einmal hiesse zwei
	 * Abfragen ueber bis zu 5000 Zeilen je Takt.
	 */
	private _applyMsgFilter(bReloadChart = false): void {
		// Alle vier Zustaende laufen hier zusammen - ein Anschlusspunkt
		// genuegt, statt ihn in jeden Handler einzeln zu haengen.
		this._syncUrl();

		// Es gibt nur noch die Vorgangssicht (Festlegung Maring, 03.09.2026).
		// Die flache, serverseitig geblaetterte Meldungstabelle ist entfallen -
		// ein Ereignis ist eine Zeile, die Einzelschritte stehen dahinter.
		/*
		 * 🔴 BEIDE LADER BEKOMMEN DIESELBE GENERATION MIT.
		 *
		 * Sie laufen parallel, und ihre Ergebnisse duerfen nur verglichen
		 * werden, wenn sie zum SELBEN Filterstand gehoeren. Ohne die Marke
		 * verglich _checkTabCount( ) am 14.09.2026 die frisch gruppierte
		 * Menge gegen einen Reiterzaehler aus dem VORIGEN Lauf - im Protokoll
		 * gut zu sehen: "Server 370 / Browser 249", dann "249 / 134", dann
		 * "134 / 370". Dieselben drei Zahlen, um eins verschoben. Die Warnung
		 * beschuldigte die Daten, obwohl die Reihenfolge schuld war.
		 */
		const iGen = ++this._iFilterGen;
		void this._loadCascades(iGen);
		// Die Reiterzahlen gehoeren zum selben Zustand wie die Tabelle: wer
		// sie hier ausliesse, haette wieder zwei Wahrheiten nebeneinander.
		void this._loadTabCounts(iGen);
		// Und die sichtbare Fassung desselben Zustands.
		this._syncFilterChips();

		if (bReloadChart) {
			void this._loadChart();
		}
	}

	/** Den gesetzten Filterzustand als Marken ins ui-Modell schreiben. */
	private _syncFilterChips(): void {
		const oUi = this.getUiModel();
		oUi.setProperty("/filterChips", FilterChips.build(oUi, this._bundle()));
	}

	/**
	 * Eine Filtermarke entfernen.
	 *
	 * Der Schluessel kommt aus dem geloeschten Token - deshalb traegt jede
	 * Marke einen stabilen Bezeichner und nicht ihren Text: der Text ist
	 * uebersetzbar, der Bezeichner nicht.
	 */
	public onFilterChipDelete(oEvent: Event): void {
		const aTokens = (oEvent.getParameter("tokens" as never) ?? []) as { getKey(): string }[];
		const oUi = this.getUiModel();
		let bChanged = false;
		aTokens.forEach((oToken) => {
			bChanged = FilterChips.clear(oUi, oToken.getKey()) || bChanged;
		});
		if (bChanged) {
			this._applyMsgFilter();
		}
	}

	/**
	 * Ein Spaltentrichter wurde angewandt.
	 *
	 * Der Wert steht durch die Zwei-Wege-Bindung schon im ui-Modell - hier
	 * wird nur noch nachgeladen. Bewusst am search-Ereignis und NICHT an
	 * liveChange: jeder Tastendruck waere sonst eine Serverabfrage, dieselbe
	 * Regel wie bei der Freitextsuche.
	 */
	public onColumnFilterApply(): void {
		this._applyMsgFilter();
	}

	/** Alle Filtermarken auf einmal entfernen. */
	public onFilterReset(): void {
		FilterChips.clearAll(this.getUiModel());
		this._applyMsgFilter();
	}

	/**
	 * Prozess- und Typfilter als Filterliste.
	 *
	 * Ausgelagert, weil sie mehrfach gebraucht wird: fuer den Ladevorgang der
	 * Vorgangs-Verdichtung und - seit 11.09.2026 - fuer die Reiterzaehler.
	 * Zwei Kopien wuerden auseinanderlaufen, und dann zeigte der Reiter eine
	 * andere Menge als die Tabelle darunter. Genau das war der Zustand
	 * davor.
	 *
	 * @param sProcessOverride Prozess, fuer den gefiltert werden soll -
	 *        sonst der gewaehlte Reiter. Nur die Zaehler brauchen das: sie
	 *        fragen dieselbe Kette fuer JEDEN Reiter ab, unter denselben
	 *        Nebenbedingungen (Typ, Suche, "Nur offene", Tag).
	 * @param bOmitTypeAndDay Typ- und Tagesfilter weglassen. Genau EIN
	 *        Aufrufer braucht das: der Verlauf. Der Typ ist dort die eigene
	 *        Achse (die Stapel E/W/S), und der Tag ist das, was man im
	 *        Diagramm auswaehlt - beides anzuwenden hiesse, das Diagramm auf
	 *        das zusammenzuziehen, was man gerade daraus ausgewaehlt hat.
	 */
	private _msgFilters(sProcessOverride?: string, bOmitTypeAndDay = false): Filter[] {
		const sProcess = sProcessOverride
			?? (this.getUiModel().getProperty("/selectedProcess") as string);
		const sType = bOmitTypeAndDay
			? ""
			: (this.getUiModel().getProperty("/selectedType") as string);
		const aFilters: Filter[] = [];

		if (sProcess === ProcessAxis.KEY_UNASSIGNED) {
			aFilters.push(ProcessAxis.unassignedFilter());
		} else if (sProcess !== ProcessAxis.KEY_ALL && sProcess !== ProcessAxis.KEY_ORDERS) {
			const oProcess = ProcessAxis.processFilter(sProcess);
			if (oProcess) {
				aFilters.push(oProcess);
			}
		}

		// Ueber LogTypeAxis, nicht als nacktes EQ: der Knopf "Fehler" buendelt
		// seit 11.09.2026 E und W, und die Zuordnung gehoert an EINE Stelle.
		const oType = LogTypeAxis.filter(sType);
		if (oType) {
			aFilters.push(oType);
		}

		/*
		 * Tagesfilter - der Absprung aus dem Verlaufsdiagramm.
		 *
		 * 🔴 UEBER CreatedAt (Edm.Date) MIT EQ, NICHT UEBER CreatedAtStamp MIT
		 * BT. Der Chart bucketiert in LogAggregator ueber genau dieses Feld,
		 * und CreatedAt ist im CDS-View per tstmp_to_dats aus dem UTC-
		 * Zeitstempel abgeleitet. Lokale Tagesgrenzen auf dem Zeitstempel
		 * laegen bis zu zwei Stunden daneben - der Balken saegte 40 und die
		 * Tabelle zeigte 38 Zeilen, ohne dass jemand herausfaende warum.
		 *
		 * ⚠ DIE MUSTERPRUEFUNG IST KEIN ZIERRAT. Der Wert kommt aus der
		 * Adresszeile und ist von Hand tippbar. Ein ungeprueftes "?dt=heute"
		 * ginge unveraendert in den $filter, der Service antwortete mit 400 -
		 * und weil UI5 V4 alle Startanfragen in EINEN $batch legt, risse das
		 * dieselbe Kaskade wie die 404 vom 09.09.2026, bei der die ganze
		 * Oberflaeche leer blieb.
		 */
		const sDay = bOmitTypeAndDay
			? ""
			: ((this.getUiModel().getProperty("/selectedDay") as string) ?? "");
		if (/^\d{4}-\d{2}-\d{2}$/.test(sDay)) {
			aFilters.push(new Filter({
				path: "CreatedAt", operator: FilterOperator.EQ, value1: sDay
			}));
		}

		/*
		 * Spaltentrichter - dieselbe Kette, nur ein anderes Bedienelement.
		 *
		 * Durchweg Contains, nie EQ: TPA-Nummer und Material stehen in der
		 * Datenbank in anderer Schreibweise als in der Anzeige (fuehrende
		 * Nullen), und die Meldung will man ohnehin nach Teiltext durchsuchen.
		 * Dieselbe Begruendung wie bei der Freitextsuche darunter.
		 */
		([
			["ItemNumber", "/filterItem"],
			["TpaNumber", "/filterTpa"],
			["Message", "/filterMessage"]
		] as [string, string][]).forEach(([sField, sPath]) => {
			const sValue = ((this.getUiModel().getProperty(sPath) as string) ?? "").trim();
			if (sValue) {
				aFilters.push(new Filter({
					path: sField, operator: FilterOperator.Contains, value1: sValue
				}));
			}
		});

		// "Nur offene" - seit dem CDS-Pushdown SERVERSEITIG moeglich.
		// IsResolved ist ein berechnetes Feld in ZLE_AUST_C_APPL_LOG; dass es
		// filterbar ist, wurde am 01.09.2026 direkt gegen den Service geprueft
		// (SADL schliesst berechnete Felder auf Pfadausdruecken nicht immer
		// vom $filter aus - hier tut es das nicht).
		//
		// NE 'X' statt EQ '': faengt auch Zeilen, bei denen das Feld gar nicht
		// gefuellt ist, statt sich auf den Leerstring zu verlassen.
		if (this.getUiModel().getProperty("/openOnly") as boolean) {
			aFilters.push(new Filter({
				path: "IsResolved", operator: FilterOperator.NE, value1: "X"
			}));
		}

		/*
		 * Suche ueber drei Felder, ODER-verknuepft und mit Contains.
		 *
		 * Contains loest zwei Probleme auf einmal, die sonst je eine
		 * Sonderbehandlung braeuchten: die TPA-Nummer steht 10-stellig mit
		 * fuehrenden Nullen in der Tabelle ("0006024397"), getippt wird sie
		 * aber ohne ("6024397"); und die Materialnummer liegt in zwei
		 * Schreibweisen vor ("4028" und "000000000000004028"). Contains
		 * findet beide Male, ohne dass hier normalisiert werden muss.
		 *
		 * Message ist mit drin, weil "Stammdaten" oder "ME-Abweichung" die
		 * naheliegendste Suche ist, wenn man einem Fehlerbild nachgeht.
		 *
		 * 🔴 BusinessKey MUSS dabei sein, und das war er bis 27.08.2026 nicht.
		 * Wer die 17-stellige HiLIS-Auftragsnummer aus einem HiLIS-Bildschirm
		 * einfuegt, fand ohne ihn NUR die Consumer-Zeilen - die Trigger-Zeilen
		 * tragen in TpaNumber die 10-stellige TANUM und die lange Form
		 * ausschliesslich im BusinessKey. Derselbe Defekt wie im Popover, nur
		 * an der zweiten Stelle.
		 */
		const sSearch = this.getUiModel().getProperty("/searchTerm") as string;
		if (sSearch) {
			aFilters.push(new Filter({
				and: false,
				filters: ["TpaNumber", "BusinessKey", "ItemNumber", "Message"].map((sField) => new Filter({
					path: sField, operator: FilterOperator.Contains, value1: sSearch
				}))
			}));
		}

		return aFilters.length ? [new Filter({ filters: aFilters, and: true })] : [];
	}

	/**
	 * allSettled statt all: ein gescheiterter Lader darf die anderen nicht
	 * abbrechen - jeder protokolliert seinen Fehler selbst.
	 */
	private async _loadData(): Promise<void> {
		this._stampRefresh();
		await Promise.allSettled([
			this._loadChart(),
			this._loadKpis(),
			this._loadMatCmpRun(),
			this._loadSapPositions(),
			this._loadShadowedPicks(),
			this._loadReprocMap()
		]);
	}

	/**
	 * Reichert die Auftragstabelle um MHD und ME aus LTAP an.
	 *
	 * 🔴 F-01 verlangt "Uebersicht offener WE-Auftraege inkl. Status, MHD,
	 * Charge, ME". ZLE_AUST_TPA_SYNC fuellt MEASUREMENT_UNIT und
	 * BEST_BEFORE_DATE aber NIE - beide kommen nicht aus GET_ORDER_LIST, die
	 * Spalten waren strukturell leer. Die Anforderung galt deshalb als "nur
	 * teilweise erfuellbar". Mit dem Lookup-Service ist sie es nicht mehr.
	 *
	 * ⚠ Die Tabelle wird NICHT umgebunden: das Nachschlagewerk haengt als
	 * Bindungsteil an den zwei Zellen, die es brauchen. So bleiben
	 * serverseitiges Blaettern und Sortieren der OData-Bindung erhalten.
	 */
	private async _loadSapPositions(): Promise<void> {
		const oModel = this._jsonModel("sapPos", { map: {} });
		try {
			const oBinding = this.getODataModel("tpaModel")
				.bindList("/Tpa", undefined, [], [], { $select: "OrderNumber" });
			const aContexts = await oBinding.requestContexts(0, 2000);
			const aOrders = aContexts.map((oContext) =>
				(oContext.getProperty("OrderNumber") as string) ?? "");
			/*
			 * 🔴 getODataModel( ) - NICHT getView( ).getModel( ).
			 *
			 * Waehrend onInit sind die Modelle der Component noch NICHT an die
			 * View durchgereicht; getView( ).getModel( ) liefert dort
			 * undefined. Genau daran sind diese Anreicherung UND die
			 * WA-Pruefung still gescheitert: beide laufen aus _loadData( ) im
			 * Start, das Popover dagegen erst auf Klick - und funktionierte
			 * deshalb.
			 *
			 * BaseController.getODataModel( ) geht ueber die Component und ist
			 * damit von Anfang an belastbar. Chart und Kennzahlen benutzen es
			 * laengst; nur meine drei Lookup-Aufrufe taten es nicht.
			 *
			 * ⚠ Dieselbe Falle wie bei _bundle( ) am selben Tag. Dort hatte
			 * ich sie erkannt und behoben - und die Erkenntnis nicht auf die
			 * Modellzugriffe uebertragen.
			 */
			const oResult = await TaPositions.loadByOrders(
				this.getODataModel("lookupModel"), aOrders);
			oModel.setProperty("/map", oResult.map);
			// ⚠ tsc hat DIESE Stelle nicht gemeldet, als loadByOrders seinen
			// Rueckgabetyp aenderte - setProperty nimmt any. Die Umstellung
			// muss hier von Hand nachgezogen werden.
			this.getUiModel().setProperty("/sapPosTruncated", oResult.truncated);
		} catch (oError) {
			// Zugabe, kein Bestandteil: faellt sie aus, bleiben die zwei
			// Spalten leer wie vorher.
			// eslint-disable-next-line no-console
			console.error("[Auftraege] Anreicherung aus LTAP fehlgeschlagen:", oError);
		}
	}

	/**
	 * Vollstaendigkeitspruefung Warenausgang.
	 *
	 * Siehe model/TaPositions.ts - geprueft wird gegen die SAP-Daten, NICHT
	 * gegen den Log: der Outbound-Pfad protokolliert Erfolge gar nicht, ein
	 * fehlender Eintrag waere also kein Befund.
	 */
	private async _loadShadowedPicks(): Promise<void> {
		const oModel = this._jsonModel("wacheck", { rows: [] });
		const oFrom = new Date();
		oFrom.setDate(oFrom.getDate() - Main.WA_CHECK_DAYS);
		const oResult = await TaPositions.loadAutoStore(
			this.getODataModel("lookupModel"),
			oFrom.toISOString().slice(0, 10)
		);
		const aShadowed = TaPositions.shadowedPicks(oResult.rows);
		oModel.setProperty("/rows", aShadowed);
		this.getUiModel().setProperty("/waCheckCount", aShadowed.length);
		/*
		 * 🔴 Bei einer VOLLSTAENDIGKEITSpruefung ist ein stiller Deckel der
		 * schlimmste Fehler: die Liste behauptete dann, es gebe keine weiteren
		 * Faelle. Deshalb wird die Kappung angezeigt, wie beim Verlauf und bei
		 * der Vorgangsverdichtung auch.
		 */
		this.getUiModel().setProperty("/waCheckTruncated", oResult.truncated);
		/*
		 * 🔴 "Geprueft, nichts gefunden" gegen "nicht geprueft".
		 *
		 * Beides ergibt eine leere Tabelle und eine 0 am Reiter. Der
		 * Leerzustand darf aber nur im ERSTEN Fall Entwarnung geben - im
		 * zweiten waere er eine Behauptung ohne Grundlage. Genau danach war
		 * gefragt worden ("kann ich die Null hier finden?"), und die Antwort
		 * war: nein, nicht ohne dieses Kennzeichen.
		 */
		this.getUiModel().setProperty("/waCheckOk", oResult.ok);
	}

	/** Legt ein JSON-Modell einmalig an und liefert es. */
	private _jsonModel(sName: string, oInitial: object): JSONModel {
		let oModel = this.getView()?.getModel(sName) as JSONModel | undefined;
		if (!oModel) {
			oModel = new JSONModel(oInitial);
			this.getView()?.setModel(oModel, sName);
		}
		return oModel;
	}

	/**
	 * Namensraum des Service zur LAUFZEIT ermitteln, statt ihn zu verdrahten.
	 *
	 * Eine gebundene OData-V4-Aktion wird ueber ihren voll qualifizierten
	 * Namen aufgerufen. Der Namensraum eines RAP-Service folgt zwar dem
	 * Muster com.sap.gateway.srvd.<service>.v0001, aber "folgt dem Muster"
	 * ist nicht "steht fest" - und ein falscher String faellt erst beim Klick
	 * auf, nicht beim Bauen.
	 *
	 * /$EntityContainer liefert den voll qualifizierten Namen des Containers;
	 * das letzte Segment abgeschnitten ist der Namensraum. Damit uebersteht
	 * die Stelle auch eine Umbenennung des Service.
	 */
	private async _actionNamespace(oModel: ODataModel): Promise<string> {
		const sContainer = await oModel.getMetaModel().requestObject("/$EntityContainer") as string;
		return sContainer.replace(/\.[^.]+$/, "");
	}

	/**
	 * Arbeitsvorrat als Nachschlagewerk laden.
	 *
	 * Haengt als Bindungsteil an der Spalte "Wiederanstoss" - dieselbe Bauform
	 * wie sapPos bei den TA-Positionen. Die Vorgangstabelle wird NICHT
	 * umgebunden: sie haengt an cascade>/rows, und ein zweites Modell als
	 * Bindungsteil kostet nichts.
	 *
	 * Geladen wird nur, was Handlungsbedarf hat - Erledigtes waere Ballast.
	 */
	private async _loadReprocMap(): Promise<void> {
		const oResult = await ReprocLookup.load(this.getODataModel("reprocModel"));
		const oModel = this._jsonModel("reproc", { map: {} });
		oModel.setProperty("/map", oResult.map);
		// Die erledigten Saetze - der Abgleich "Fehler behoben?" am Vorgang.
		oModel.setProperty("/mapDone", oResult.mapDone);
		oModel.setProperty("/total", oResult.total);
		oModel.setProperty("/truncated", oResult.truncated);
		oModel.setProperty("/ok", oResult.ok);
		oModel.setProperty("/error", oResult.error);
		// Die erledigten Saetze entscheiden mit, was "Nur offene" ausblendet -
		// die Tabelle muss deshalb nachziehen, sobald sie da sind.
		this._applyOpenOnly();
	}

	/**
	 * Verlauf laden und die Obergrenze ehrlich beschriften.
	 *
	 * Der Warnhinweis nennt seit 11.09.2026 drei Dinge statt "Datenmenge
	 * gekuerzt": wie viele Meldungen es im Zeitraum gibt, wie viele davon
	 * ausgewertet wurden, und AB WANN der Verlauf gilt. Erst das macht ihn
	 * benutzbar - vorher blieb offen, ob die Balken um ein Prozent oder um
	 * die Haelfte danebenliegen.
	 *
	 * ⚠ Der Zeitstempel ist ueberhaupt erst seit der Sortierung in
	 * LogAggregator eine haltbare Aussage. Ohne sie gab es keinen Schnitt,
	 * sondern eine beliebige Teilmenge.
	 */
	private async _loadChart(): Promise<void> {
		try {
			const oData = await LogAggregator.loadLastDays(
				this.getODataModel("mainModel"),
				Number(this.getUiModel().getProperty("/chartDays")) || Main.CHART_DAYS,
				// Der Verlauf folgt seit 11.09.2026 der gewaehlten Sicht:
				// Prozess, Suche, "Nur offene". Vorher zaehlte er ueber ALLE
				// Reiter, waehrend die Tabelle nur einen zeigte - wer auf
				// einen Balken mit 40 klickte, bekam sechs Zeilen.
				this._msgFilters(undefined, true)
			);
			(this.getView()?.getModel("chart") as JSONModel).setData(oData);
			this.getUiModel().setProperty("/chartTruncated", oData.truncated);

			const oUi = this.getUiModel();
			if (oData.truncated) {
				const oBundle = this._bundle();
				const sCut = this.formatter.timestamp(oData.cutAt);
				oUi.setProperty("/chartCutText", oBundle.getText("chartCut", [sCut]) ?? "");
				oUi.setProperty("/chartCutTip", oBundle.getText("chartCutTip", [
					this.formatter.countText(oData.total),
					this.formatter.countText(oData.loaded),
					sCut
				]) ?? "");
			} else {
				oUi.setProperty("/chartCutText", "");
				oUi.setProperty("/chartCutTip", "");
			}
		} catch (oError) {
			// eslint-disable-next-line no-console
			console.error("[Verlauf] Aggregation fehlgeschlagen:", oError);
		}
	}

	private async _loadKpis(): Promise<void> {
		await Promise.all(KpiLoader.metrics.map(async (oDefinition) => {
			try {
				const nCount = await KpiLoader.loadCount(
					this.getODataModel(oDefinition.model),
					oDefinition
				);
				this.getUiModel().setProperty("/kpi/" + oDefinition.key, String(nCount));
			} catch (oError) {
				// eslint-disable-next-line no-console
				console.error("[KPI] " + oDefinition.key + " fehlgeschlagen:", oError);
			}
		}));
	}

	/**
	 * Die Zahlen neben den Reitersymbolen.
	 *
	 * 🔴 SIE FOLGEN SEIT 11.09.2026 DEM FILTER. Vorher zaehlten sie ueber
	 * einen rohen OData-String je Prozess und kannten weder Typfilter noch
	 * Suche noch "Nur offene" - nach jeder Eingrenzung standen am Reiter und
	 * in der Tabelle verschiedene Mengen, und der Reiter hatte immer die
	 * groessere. Gefragt war genau das: "dynamische Nummern neben den
	 * Reiter-Icons dann auch anpassen".
	 *
	 * Gebaut wird jede Zahl aus DERSELBEN Kette wie die Tabelle, nur mit
	 * ausgetauschtem Prozess. Damit kann sie gar nicht mehr abweichen.
	 *
	 * ⚠ Alle Abfragen laufen ueber dasselbe Modell und werden in derselben
	 * Microtask abgesetzt - das V4-Modell buendelt sie in EINEN $batch. Es
	 * ist also ein Roundtrip je Filterwechsel, nicht fuenf.
	 *
	 * ⚠ Gezaehlt werden MELDUNGEN, angezeigt werden VORGAENGE. Die
	 * Zusammenfassungszeile nennt beide Zahlen nebeneinander und stellt den
	 * Bezug her; am Reiter steht nur die eine, deshalb sagt sein Tooltip,
	 * welche es ist.
	 */
	private async _loadTabCounts(iGen = 0): Promise<void> {
		// Die Reiter, die eine Meldungsmenge zaehlen. TPA, WACHECK und MATCMP
		// sind keine - sie haben eigene Quellen und keine Zahl am Reiter.
		const aKeys = [
			...ProcessAxis.processes.map((oProcess) => oProcess.key),
			ProcessAxis.KEY_UNASSIGNED,
			ProcessAxis.KEY_ALL
		];

		await Promise.all(aKeys.map(async (sKey) => {
			try {
				const aFilters = this._msgFilters(sKey);
				/*
				 * VORGAENGE, nicht Meldungen (Festlegung Tolksdorf,
				 * 11.09.2026). Die Tabelle zeigt Vorgaenge - stand am Reiter
				 * eine Meldungszahl, war die groessere Zahl die sichtbare und
				 * die kleinere die wahre.
				 *
				 * -1 heisst "der Service kann kein $apply". Dann bleibt es bei
				 * der Meldungszahl, und der Tooltip sagt es; eine 0
				 * hinzuschreiben waere eine Behauptung.
				 */
				const nOps = await KpiLoader.loadOperationCount(
					this.getODataModel("mainModel"), "/AppLog", aFilters);
				const nCount = nOps >= 0
					? nOps
					: await KpiLoader.loadCount(
						this.getODataModel("mainModel"),
						{ path: "/AppLog", select: "LogUuid" },
						aFilters);
				this.getUiModel().setProperty("/kpi/tab" + sKey, String(nCount));
			} catch (oError) {
				// eslint-disable-next-line no-console
				console.error("[Reiterzaehler] " + sKey + " fehlgeschlagen:", oError);
			}
		}));
		// Steuert die Beschriftung: zaehlen die Reiter Vorgaenge oder Meldungen?
		this.getUiModel().setProperty("/tabCountsAreOps", KpiLoader.isApplySupported());
		// Marke, zu welchem Filterstand diese Zahlen gehoeren.
		this.getUiModel().setProperty("/kpi/gen", iGen);
		this._checkTabCount();
		/*
		 * Die Zusammenfassung nennt bei gekappter Sicht die Gesamtzahl mit -
		 * und die steht erst jetzt fest. _loadCascades und _loadTabCounts
		 * laufen parallel, die Reihenfolge ist also nicht zugesichert.
		 * Neuberechnen kostet nichts: es ist reine Rechnerei auf schon
		 * geladenen Daten.
		 */
		this._applyOpenOnly();
	}

	/**
	 * Kopf des letzten Materialstammabgleichs (Punkt 38, Fall 4).
	 *
	 * 🔴 UEBER EINE LISTEN-BINDUNG, NICHT UEBER MatCompareRun('1').
	 * Die Einzelentitaet gibt es erst, wenn der Report einmal mit
	 * "Ergebnis fortschreiben" gelaufen ist. Vorher antwortet der Service
	 * mit 404 - und weil UI5 alle Startanfragen in EINEN $batch legt, riss
	 * diese eine 404 am 09.09.2026 die ganze App mit: AppLog, KPIs und
	 * Verlauf meldeten "previous request failed", die Oberflaeche blieb
	 * leer.
	 *
	 * Eine Listen-Bindung auf die MENGE kennt diesen Zustand nicht: leer
	 * ist null Zeilen, kein Fehler. Das Ergebnis landet im ui-Modell,
	 * damit der View gar keine OData-Bindung auf diesen Kopf braucht.
	 */
	/**
	 * Ein Wert aus einer OData-Zeile als Text - aber nur, wenn er ein
	 * Skalar ist.
	 *
	 * Alles andere (Objekt, Feld, null) faellt auf den Rueckfallwert zurueck.
	 * Ein String( ) auf ein Objekt ergaebe "[object Object]", und das saehe in
	 * der Kopfzeile wie eine Angabe aus, wo keine ist.
	 */
	private static _scalarText(vValue: unknown, sFallback = ""): string {
		if (typeof vValue === "string") {
			return vValue;
		}
		if (typeof vValue === "number" || typeof vValue === "boolean") {
			return String(vValue);
		}
		return sFallback;
	}

	private async _loadMatCmpRun(): Promise<void> {
		try {
			const oBinding = this.getODataModel("mainModel").bindList("/MatCompareRun");
			const aContexts = await oBinding.requestContexts(0, 1);
			if (aContexts.length === 0) {
				return;
			}
			const oRun = aContexts[0].getObject() as Record<string, unknown>;
			/*
			 * Ueber scalarText( ) statt String( ): die Felder kommen als
			 * unknown aus getObject( ), und ein String( ) auf ein Objekt
			 * ergaebe "[object Object]" - ein Platzhalter, der wie ein Wert
			 * aussieht. Dieselbe Regel wie in model/TaPositions.ts und
			 * model/ReprocLookup.ts.
			 */
			this.getUiModel().setProperty("/matCmp", {
				runAt:      Main._scalarText(oRun.RunAt),
				cntSap:     Main._scalarText(oRun.CntSap, "0"),
				cntHilis:   Main._scalarText(oRun.CntHilis, "0"),
				cntDiff:    Main._scalarText(oRun.CntDiff, "0"),
				cntOnlySap: Main._scalarText(oRun.CntOnlySap, "0"),
				cntOnlyHil: Main._scalarText(oRun.CntOnlyHil, "0"),
				cntOk:      Main._scalarText(oRun.CntOk, "0"),
				broken:     oRun.Broken === "X"
			});
		} catch (oError) {
			// eslint-disable-next-line no-console
			console.error("[Stammdatenabgleich] Laufkopf fehlgeschlagen:", oError);
		}
	}

	/**
	 * Chart-Darstellung: Legende unter das Diagramm, Stapelfarben auf die
	 * semantischen Theme-Farben, damit sie zur Kritikalitaets-Darstellung in
	 * den Tabellen passen.
	 *
	 * Die Legendenposition sitzt unter legendGroup.layout.position - nicht
	 * unter legend, das steuert nur Sichtbarkeit und Titel der Legende.
	 * Referenz: https://ui5.sap.com/docs/vizdocs/index.html
	 */
	private _applyChartProperties(): void {
		const oVizFrame = this.byId("idTrendVizFrame") as VizFrame | undefined;
		if (!oVizFrame) {
			return;
		}
		ChartColors.resolvePalette((aColors) => {
			oVizFrame.setVizProperties({
				plotArea: { colorPalette: aColors, dataLabel: { visible: false } },
				legend: { visible: true, title: { visible: false } },
				legendGroup: { layout: { position: "bottom", alignment: "center" } },
				title: { visible: false },
				valueAxis: { title: { visible: false } },
				categoryAxis: { title: { visible: false } },
				/*
				 * AUSWAHL - die Voraussetzung fuer den Absprung in die
				 * Tabelle.
				 *
				 * ⚠ single, nicht die Voreinstellung multiple: sonst SAMMELT
				 * jeder Klick eine weitere Markierung ein, und der Anwender
				 * baut sich unbemerkt eine Mehrfachauswahl zusammen, aus der
				 * ein Tagesfilter nicht abzuleiten ist.
				 *
				 * axisLabelSelection macht zusaetzlich die Beschriftung der
				 * Kategorieachse anklickbar - damit laesst sich der GANZE Tag
				 * waehlen statt nur ein Segment. Kennt die installierte
				 * Fassung die Eigenschaft nicht, wird sie ignoriert; der
				 * Segmentklick bleibt der Weg, und der Typ-Chip laesst sich
				 * in der Filterleiste einzeln wegnehmen.
				 */
				interaction: {
					selectability: {
						mode: "single",
						axisLabelSelection: true
					}
				}
			});
		});
	}

	/**
	 * Klick auf einen Balken: Tag (und ggf. Typ) in den Tabellenfilter.
	 *
	 * 🔴 DIE NUTZLAST WIRD NICHT GERATEN, SONDERN GEGEN DAS DATASET
	 * AUFGELOEST. VizFrame liefert die Auswahl je nach Fassung als Liste von
	 * {val, ctx} oder als Objekt, dessen Schluessel die NAMEN von Dimension
	 * und Measure sind. Die Namen kommen aber aus dem Sprachbuendel
	 * ({i18n>chartSeriesE} = "Fehler") - ein Vergleich dagegen waere ein
	 * Vergleich gegen eine Uebersetzung und braeche in der englischen
	 * Oberflaeche. Deshalb wird zur Laufzeit aus dem Dataset eine
	 * Umkehrtabelle Name -> identity gebaut; identity ist genau dafuer da
	 * (s. Kommentar am FlattenedDataset).
	 *
	 * ⚠ Der Dimensionswert ist das ETIKETT ("11.09."), nicht das ISO-Datum -
	 * die DimensionDefinition bindet value="{chart>label}". Das Datum kommt
	 * deshalb ueber eine Zuordnung aus chart>/days.
	 *
	 * ⚠ Am Ende wird die Auswahl geleert. Ohne das bliebe das Segment
	 * markiert, und ein ZWEITER Klick darauf waere eine Abwahl - er feuert
	 * dann gar nicht, und fuer den Anwender "tut der Chart nichts mehr".
	 */
	public onChartSelect(oEvent: Event): void {
		const oVizFrame = this.byId("idTrendVizFrame") as VizFrame | undefined;
		if (!oVizFrame) {
			return;
		}

		const mIdentities = Main._vizIdentities(oVizFrame);
		const aPoints = (oEvent.getParameter("data" as never) ?? []) as unknown[];

		const aLabels: string[] = [];
		const aTypes: string[] = [];
		aPoints.forEach((vPoint) => {
			Main._readVizPoint(vPoint, mIdentities, aLabels, aTypes);
		});

		const sDay = Main._dayForLabel(this.getView()?.getModel("chart") as JSONModel | undefined,
			aLabels[0] ?? "");
		if (!sDay) {
			// Ohne Tag gibt es nichts zu filtern - und die Markierung muss
			// trotzdem weg, sonst blockiert sie den naechsten Klick.
			Main._clearVizSelection(oVizFrame);
			return;
		}

		const oUi = this.getUiModel();
		oUi.setProperty("/selectedDay", sDay);
		/*
		 * Nur bei EINDEUTIGEM Typ auch den Typfilter setzen. Traf der Klick
		 * die Achsenbeschriftung, kommen alle drei Reihen des Tages - dann
		 * ist "der ganze Tag" gemeint, und ein Typ waere hinzuerfunden. Der
		 * bestehende Typfilter bleibt in diesem Fall, wie er ist.
		 */
		if (aTypes.length === 1) {
			oUi.setProperty("/selectedType", aTypes[0]);
		}

		Main._clearVizSelection(oVizFrame);
		this._applyMsgFilter();
	}

	/** Anzeigename -> identity, aus dem Dataset des Charts. */
	private static _vizIdentities(oVizFrame: VizFrame): Map<string, string> {
		const mMap = new Map<string, string>();
		const oDataset = oVizFrame.getDataset() as unknown as {
			getDimensions?: () => { getName(): string; getIdentity(): string }[];
			getMeasures?: () => { getName(): string; getIdentity(): string }[];
		} | undefined;
		[...(oDataset?.getDimensions?.() ?? []), ...(oDataset?.getMeasures?.() ?? [])]
			.forEach((oDefinition) => {
				mMap.set(oDefinition.getName(), oDefinition.getIdentity());
			});
		return mMap;
	}

	/**
	 * Einen Auswahlpunkt auswerten - beide bekannten Nutzlastformen.
	 *
	 * Was hier NICHT passiert: raten. Ein Schluessel, der sich ueber die
	 * Umkehrtabelle keiner identity zuordnen laesst, wird uebergangen.
	 */
	private static _readVizPoint(
		vPoint: unknown,
		mIdentities: Map<string, string>,
		aLabels: string[],
		aTypes: string[]
	): void {
		const oPoint = (vPoint ?? {}) as { data?: unknown };
		const vData = oPoint.data;
		if (!vData || typeof vData !== "object") {
			return;
		}

		const fnTake = (sKeyOrIdentity: string, vValue: unknown): void => {
			const sIdentity = mIdentities.get(sKeyOrIdentity) ?? sKeyOrIdentity;
			if (sIdentity === "day") {
				// _scalarText statt String( ): die Nutzlast ist fremdes
				// Format, und "[object Object]" waere ein Etikett, das nie
				// einen Eimer trifft - aber eben auch kein erkennbarer Fehler.
				const sLabel = Main._scalarText(vValue).trim();
				if (sLabel) {
					aLabels.push(sLabel);
				}
			} else if (["E", "W", "S"].includes(sIdentity) && !aTypes.includes(sIdentity)) {
				aTypes.push(sIdentity);
			}
		};

		if (Array.isArray(vData)) {
			// Form 1: [{val, ctx: {type, path: {dn/mi}}}]
			(vData as { val?: unknown; name?: unknown }[]).forEach((oItem) => {
				fnTake(Main._scalarText(oItem.name), oItem.val);
			});
			return;
		}
		// Form 2: {"<Anzeigename>": <Wert>, ...}
		Object.entries(vData as Record<string, unknown>).forEach(([sKey, vValue]) => {
			fnTake(sKey, vValue);
		});
	}

	/** Etikett ("11.09.") -> ISO-Tag, aus den Eimern des Charts. */
	private static _dayForLabel(oChart: JSONModel | undefined, sLabel: string): string {
		if (!oChart || !sLabel) {
			return "";
		}
		const aDays = (oChart.getProperty("/days") ?? []) as { day?: string; label?: string }[];
		return aDays.find((oBucket) => oBucket.label === sLabel)?.day ?? "";
	}

	private static _clearVizSelection(oVizFrame: VizFrame): void {
		const oSelectable = oVizFrame as unknown as {
			vizSelection?: (aPoints: unknown[], oOptions: { clearSelection: boolean }) => void;
		};
		oSelectable.vizSelection?.([], { clearSelection: true });
	}

	private _table(sTableId: string): Table | undefined {
		return this.byId(sTableId) as Table | undefined;
	}

	private _openColumns(sTableId: string): void {
		const oTable = this._table(sTableId);
		if (oTable) {
			TableColumnState.openDialog(oTable, sTableId, this._bundle());
		}
	}

	/**
	 * Schreibt den aktuellen Zeitpunkt in das ui-Modell. Bewusst hier und nicht
	 * als Expression Binding in der View: dort waere der Wert nicht reaktiv
	 * und nicht testbar.
	 */
	/**
	 * ⚠ NUTZT DENSELBEN FORMATTER WIE DIE TABELLENSPALTEN.
	 *
	 * Vorher stand hier style: "medium", also die Locale des Browsers - auf
	 * Englisch "Aug 31, 2026, 3:23:43 PM", waehrend die Zeitstempel in den
	 * Tabellen dem festen 24-Stunden-Muster folgen. Zwei Schreibweisen
	 * derselben Uhrzeit auf einem Bildschirm.
	 *
	 * Bewusst der GEMEINSAME Formatter und nicht dasselbe Muster zum
	 * zweiten Mal: sonst driften die beiden beim naechsten Anfassen
	 * auseinander, und zwar unbemerkt.
	 */
	private _stampRefresh(): void {
		this.getUiModel().setProperty("/lastRefreshText", formatterTimestamp(new Date()));
	}

	/**
	 * Detailsicht zu einer TPA-Nummer.
	 *
	 * ⚠ Der Filterwert kommt aus dem BINDING-KONTEXT, nicht aus dem Linktext.
	 * Bei Materialnummern zeigt die Oberflaeche die normalisierte Form ("4028"),
	 * in der Datenbank steht je nach Erzeuger auch "000000000000004028" - ein
	 * Filter auf den angezeigten Text fuende die Haelfte der Zeilen nicht.
	 */
	public onTpaNumberPress(oEvent: Event): void {
		void this._openKeyPopover(oEvent, "TPA", "TpaNumber", "OrderNumber");
	}

	/** Detailsicht zu einer Materialnummer. */
	public onItemNumberPress(oEvent: Event): void {
		void this._openKeyPopover(oEvent, "ITEM", "ItemNumber", "ItemNumber");
	}

	/**
	 * Detailsicht zu einer Materialnummer AUS DEM STAMMDATENABGLEICH.
	 *
	 * Eigener Handler, weil die Vergleichszeile anders heisst und weniger
	 * kann als eine Logzeile:
	 *   - das Feld ist "Matnr", nicht "ItemNumber"
	 *   - "Lgnum" und "BusinessKey" gibt es dort NICHT
	 *
	 * Am 09.09.2026 hing der Link zunaechst an onItemNumberPress. Ergebnis
	 * im Log bei jedem Klick:
	 *   Failed to drill-down into ('5')/ItemNumber, invalid segment
	 * Der Popover ging trotzdem auf - getProperty liefert undefined statt zu
	 * werfen -, aber jeder Klick schrieb eine Fehlerzeile in die Konsole.
	 * Genau die Sorte Rauschen, die spaeter einen echten Fehler zudeckt.
	 */
	public onMatCmpMaterialPress(oEvent: Event): void {
		void this._openKeyPopover(oEvent, "ITEM", "Matnr", "Matnr", false);
	}

	/**
	 * JSON-Payload direkt aus der Meldungstabelle.
	 *
	 * Bis zum 27.08.2026 fuehrte der einzige Weg dorthin ueber das
	 * Verlaufs-Panel im Popover - und genau das war die Dublette, weil es
	 * die Tabelle wiederholte, in der man ohnehin gerade steht. Jetzt haengt
	 * das Symbol an der Zeile selbst und erscheint nur, wo es einen Payload
	 * gibt.
	 */
	public onMessagePayloadPress(oEvent: Event): void {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		// Vorgangszeilen liegen im JSON-Modell "cascade" - seit dem Wegfall
		// der flachen Tabelle ist das die einzige Quelle.
		const oContext = oSource.getBindingContext("cascade");
		if (!oContext) {
			return;
		}
		this._showPayload(
			(oContext.getProperty("JsonPayload") as string) ?? "",
			(oContext.getProperty("Message") as string) ?? "",
			this.formatter.timestamp((oContext.getProperty("CreatedAtStamp") as string) ?? "")
		);
	}


	private async _openCorrPopover(oSource: Control, sCorr: string): Promise<void> {
		const oDetail = this._detailModel();
		oDetail.setProperty("/busy", true);
		oDetail.setProperty("/log", []);
		oDetail.setProperty("/logVisible", true);
		// Kein SAP-Teil: ein Vorgang ist kein Schluessel, es gibt nichts
		// nachzuschlagen. Gleiche Entscheidung wie im Kaskaden-Popover.
		oDetail.setProperty("/sap",
			{ available: false, hint: "", header: "", fields: [], rowsHeader: "", rows: [] });

		await this._openPopover(oSource);

		try {
			const oData = await KeyDetailLoader.loadCorrDetail(
				this.getODataModel("mainModel"), sCorr, this._bundle());
			oDetail.setProperty("/title", oData.title);
			oDetail.setProperty("/logHeader", oData.logHeader);
			oDetail.setProperty("/log", oData.log);
		} catch (oError) {
			// eslint-disable-next-line no-console
			console.error("[Vorgang] Laden fehlgeschlagen:", oError);
		} finally {
			oDetail.setProperty("/busy", false);
		}
	}

	public onKeyPopoverClose(): void {
		void this._pKeyPopover?.then((oPopover) => oPopover.close());
	}

	/** Zeigt den JSON_PAYLOAD der angeklickten Logzeile. */
	public onKeyPopoverLogPress(oEvent: Event): void {
		// oEvent.getSource( ) liefert laut Typen EventProvider, dort gibt es
		// weder getBindingContext noch laesst es sich an openBy uebergeben.
		// Die Assertion ist also noetig - tsc belegt das, ESLints Regel
		// no-unnecessary-type-assertion urteilt hier falsch.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oItem = oEvent.getSource() as Control;
		const oContext = oItem.getBindingContext("detail");
		const sPayload = (oContext?.getProperty("payload") as string) ?? "";
		if (!sPayload) {
			return;
		}
		this._showPayload(
			sPayload,
			(oContext?.getProperty("message") as string) ?? "",
			(oContext?.getProperty("stamp") as string) ?? ""
		);
	}

	private _showPayload(sPayload: string, sMessage: string, sTitle: string): void {
		if (!sPayload) {
			return;
		}
		const oDetail = this._detailModel();
		oDetail.setProperty("/payload", sPayload);
		oDetail.setProperty("/payloadMessage", sMessage);
		oDetail.setProperty("/payloadTitle", sTitle);

		if (!this._pPayloadDialog) {
			this._pPayloadDialog = Fragment.load({
				id: this.getView()?.getId(),
				name: "zui5_zle_aust_mon.view.fragment.PayloadDialog",
				controller: this
			}) as Promise<Dialog>;
			void this._pPayloadDialog.then((oDialog) => this.getView()?.addDependent(oDialog));
		}
		void this._pPayloadDialog.then((oDialog) => oDialog.open());
	}

	public onPayloadClose(): void {
		void this._pPayloadDialog?.then((oDialog) => oDialog.close());
	}

	/**
	 * Das i18n-Bundle.
	 *
	 * 🔴 MIT RUECKFALL AUF DIE COMPONENT, und das ist kein Guertel-und-
	 * Hosentraeger: waehrend onInit ist das Modell der Component noch NICHT an
	 * die View durchgereicht - getModel( ) liefert dort undefined. Die frueher
	 * einzige Zeile schuetzte per "?." nur getView( ), nicht das Modell, und
	 * lief deshalb in "Cannot read properties of undefined (reading
	 * 'getResourceBundle')".
	 *
	 * Aufgefallen ist es erst, als mit _loadShadowedPicks( ) der erste
	 * Aufrufer WAEHREND onInit dazukam; alle uebrigen laufen nach einer
	 * Benutzeraktion und trafen die Luecke nie.
	 */
	/**
	 * Titel des Schluessel-Popovers.
	 *
	 * Liegt ein zerlegbarer BUSINESS_KEY vor, wird er AUFGESCHLUESSELT statt
	 * roh angezeigt: aus "00060244110001001" wird
	 * "TA 0006024411 · Position 0001 · Lager 001". Die Bildungsregel steht in
	 * Michaels Doku, KEY_TYPE sagt welche gilt - es wird also nichts geraten.
	 *
	 * Faellt die Zerlegung durch (`ok = false`), bleibt es beim Rohwert. Genau
	 * dafuer gibt es das Kennzeichen, und die Doku sagt ausdruecklich: bei
	 * ok = false sind die Teile leer und nicht "vielleicht doch brauchbar".
	 */
	private _keyTitle(
		sKind: KeyDetailLoader.KeyKind,
		sRaw: string,
		sBusinessKey: string,
		oBundle: ResourceBundle
	): string {
		if (sKind === "ITEM") {
			return oBundle.getText("popTitleItem", [formatterNormalize(sRaw)]) ?? sRaw;
		}
		const oParts = BusinessKey.split(sBusinessKey, "");
		if (oParts.ok && oParts.tanum) {
			return (oParts.tapos
				? oBundle.getText("popTitlePut", [oParts.tanum, oParts.tapos, oParts.lgnum])
				: oBundle.getText("popTitlePick", [oParts.tanum, oParts.lgnum])) ?? sRaw;
		}
		return oBundle.getText("popTitleTpa", [sRaw.trim()]) ?? sRaw;
	}

	private _bundle(): ResourceBundle {
		const oModel = (this.getView()?.getModel("i18n")
			?? this.getOwnerComponent()?.getModel("i18n")) as ResourceModel | undefined;
		return oModel?.getResourceBundle() as ResourceBundle;
	}

	private _detailModel(): JSONModel {
		let oModel = this.getView()?.getModel("detail") as JSONModel | undefined;
		if (!oModel) {
			oModel = new JSONModel({ log: [], logVisible: false, sap: { available: false, hint: "", header: "", fields: [], rowsHeader: "", rows: [] } });
			this.getView()?.setModel(oModel, "detail");
		}
		return oModel;
	}

	private async _openKeyPopover(
		oEvent: Event,
		sKind: KeyDetailLoader.KeyKind,
		sMainField: string,
		sTpaField: string,
		bMainHasLogFields = true
	): Promise<void> {
		// oEvent.getSource( ) liefert laut Typen EventProvider, dort gibt es
		// weder getBindingContext noch laesst es sich an openBy uebergeben.
		// Die Assertion ist also noetig - tsc belegt das, ESLints Regel
		// no-unnecessary-type-assertion urteilt hier falsch.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;

		/*
		 * Der Schluessel wird in ALLEN Modellen gesucht, weil dieselben
		 * Handler aus mehreren Tabellen gerufen werden:
		 *   idCascadeTable  -> cascade    (JSON, verdichtete Vorgaenge)
		 *   idTpaTable      -> tpaModel   (OData, Auftragspuffer)
		 *   idMatCmpTable   -> mainModel  (OData, Stammdatenabgleich)
		 *
		 * ⚠ Vorher standen hier nur mainModel und tpaModel. Aus der
		 * Vorgangstabelle fand der Handler damit nichts, sRaw blieb leer und
		 * die Methode stieg still aus - die Links sahen anklickbar aus und
		 * taten nichts. Derselbe Fehlertyp wie bei den leeren Zellen: ein
		 * Zeilenkontext haengt immer an EINEM Modell, und der Name muss
		 * stimmen.
		 *
		 * Die Feldnamen der Vorgangszeilen sind absichtlich die der
		 * Logzeilen, deshalb genuegt sMainField fuer beide.
		 */
		/*
		 * hasLogFields sagt, ob die Zeile die Felder aus ZLE_AUST_APL_LOG
		 * traegt. Der Auftragspuffer (Tpa) hat sie NICHT - dort waere ein
		 * getProperty("Lgnum") ein Zugriff auf eine Eigenschaft, die es in
		 * der Entitaet gar nicht gibt.
		 */
		const aSources: { model: string; field: string; hasLogFields: boolean }[] = [
			{ model: "mainModel", field: sMainField, hasLogFields: bMainHasLogFields },
			{ model: "cascade", field: sMainField, hasLogFields: true },
			{ model: "tpaModel", field: sTpaField, hasLogFields: false }
		];

		let sRaw = "";
		let sLgnum = "";
		let sBusinessKey = "";
		for (const oSrc of aSources) {
			const oCtx = oSource.getBindingContext(oSrc.model);
			const sValue = (oCtx?.getProperty(oSrc.field) as string) ?? "";
			if (sValue.trim()) {
				sRaw = sValue;
				if (oSrc.hasLogFields) {
					// Seit Michaels Logging-Umbau traegt der Logsatz die
					// Lagernummer selbst - vorher stand dafuer ein hart
					// codiertes "001" im Lookup.
					sLgnum = (oCtx?.getProperty("Lgnum") as string) ?? "";
					sBusinessKey = (oCtx?.getProperty("BusinessKey") as string) ?? "";
				}
				break;
			}
		}

		if (!sRaw) {
			return;
		}

		const oDetail = this._detailModel();
		oDetail.setProperty("/busy", true);
		oDetail.setProperty("/log", []);
		oDetail.setProperty("/logVisible", false);

		await this._openPopover(oSource);

		try {
			/*
			 * SAP ZUERST, und der Log NUR wenn er gebraucht wird.
			 *
			 * Stehen die SAP-Felder, ist das Verlaufs-Panel ausgeblendet -
			 * dann waere ein Ladevorgang dafuer eine Abfrage fuer nichts.
			 * Deshalb hier bewusst nacheinander statt parallel: die
			 * Rueckfallebene kostet nur dann, wenn sie eintritt.
			 */
			const oSapData = await SapLookup.load(
				this.getODataModel("lookupModel"),
				sKind,
				sRaw,
				this._bundle(),
				sLgnum
			);
			oDetail.setProperty("/sap", oSapData);

			const oBundle = this._bundle();
			oDetail.setProperty("/title", this._keyTitle(sKind, sRaw, sBusinessKey, oBundle));

			if (!oSapData.available) {
				const oDetailData = await KeyDetailLoader.loadKeyDetail(
					this.getODataModel("mainModel"),
					sKind,
					sRaw,
					oBundle,
					sBusinessKey
				);
				oDetail.setProperty("/logHeader", oDetailData.logHeader);
				oDetail.setProperty("/log", oDetailData.log);
				oDetail.setProperty("/logVisible", true);
			}
		} catch {
			oDetail.setProperty("/logHeader", this._bundle().getText("popLoadFailed") ?? "");
			oDetail.setProperty("/logVisible", true);
			oDetail.setProperty("/sap", { available: false, hint: "", header: "", fields: [], rowsHeader: "", rows: [] });
		} finally {
			oDetail.setProperty("/busy", false);
		}
	}

	/*
	 * ℹ onCorrPress( ) ist am 11.09.2026 entfallen, zusammen mit dem
	 * Uhrsymbol in der Spalte "Details". Der Weg selbst lebt weiter und ist
	 * jetzt der EINZIGE: onCascadePress( ) ruft _openCorrPopover( ) direkt.
	 *
	 * Die Unterscheidung, die der Handler traegt, bleibt richtig und steht
	 * dort dokumentiert - sie war nur nie eine Unterscheidung, die man
	 * BEDIENEN kann:
	 *   aus dem Speicher  die geladenen, gruppierten Schritte. Gedeckelt bei
	 *                     MAX_OPS (5000 Vorgaenge) und bei Sammellaeufen
	 *                     zusaetzlich bei MAX_STEPS.
	 *   ueber CorrUuid    alle Meldungen des Vorgangs, auch die ausserhalb
	 *                     des geladenen Fensters.
	 * Deshalb nimmt der verbleibende Einstieg immer den zweiten Weg und faellt
	 * nur ohne Korrelations-ID auf den ersten zurueck.
	 */

	/**
	 * Die Schritte eines Vorgangs - EIN Einstieg, seit 11.09.2026.
	 *
	 * 🔴 BIS DAHIN GAB ES ZWEI, UND SIE SAHEN GLEICH AUS. Die Spalte
	 * "Schritte" zeigte die im Browser gruppierten Zeilen, das Uhrsymbol
	 * daneben fragte OData nach der CorrUuid - dasselbe Popover, dieselbe
	 * Liste, derselbe Titel. Der Unterschied (hier ein Ausschnitt, dort das
	 * Ganze) stand nur im Quelltext, und aus der Bedienung heraus war es eine
	 * Dopplung. Sie war deshalb am 03.09. schon einmal entfernt und danach
	 * wieder eingebaut worden.
	 *
	 * Aufgeloest wird das nicht durch Erklaeren, sondern durch Weglassen: der
	 * verbleibende Einstieg nimmt IMMER den vollstaendigen Weg. Die Zeilen aus
	 * dem Speicher sind nur noch die Rueckfallebene fuer Vorgaenge OHNE
	 * Korrelations-ID.
	 *
	 * ⚠ isInitialUuid, nicht bloss "nicht leer". Eine initiale CorrUuid ist
	 * kein Vorgang, sondern ihr Fehlen; ein Filter darauf zoege den gesamten
	 * Altbestand in ein Popover.
	 */
	public onCascadePress(oEvent: Event): void {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		const oContext = oSource.getBindingContext("cascade");
		const oRow = oContext?.getObject() as CascadeGrouper.CascadeRow | undefined;
		if (!oRow) {
			return;
		}

		const sCorr = String(oRow.CorrUuid ?? "").trim();
		if (sCorr && !CascadeGrouper.isInitialUuid(sCorr)) {
			void this._openCorrPopover(oSource, sCorr);
			return;
		}

		const oBundle = this._bundle();
		const oDetail = this._detailModel();

		/*
		 * Bei einem Sammellauf sagen Titel und Kopfzeile ausdruecklich, dass
		 * nur ein AUSSCHNITT zu sehen ist - StepCount nennt die wahre Zahl,
		 * Steps ist gekappt. Ein Popover, das "3212 Schritte" ueberschreibt
		 * und 25 zeigt, waere die schlechteste Variante.
		 */
		const bBulk = oRow.IsBulk === true;
		/*
		 * ⚠ Der Titel nennt KEINE Zahl mehr. Sie stand vorher hier UND in der
		 * Panel-Kopfzeile direkt darunter - dieselbe Angabe zweimal
		 * untereinander. Aufgeteilt: der Titel sagt, WAS man ansieht, die
		 * Kopfzeile, WIE VIEL. Damit entfaellt auch das Einzahl-Problem im
		 * Titel ("Vorgang mit 1 Schritten").
		 */
		oDetail.setProperty("/title",
			oBundle.getText(bBulk ? "cascTitleBulk" : "cascTitle") ?? "");
		oDetail.setProperty("/logHeader", (bBulk
			? oBundle.getText("popLogPanelBulk", [String(oRow.Steps?.length ?? 0), String(oRow.StepCount)])
			: oBundle.getText(oRow.StepCount === 1 ? "popLogPanel1" : "popLogPanel",
					[String(oRow.StepCount)])) ?? "");
		oDetail.setProperty("/busy", false);
		oDetail.setProperty("/sap", { available: false, hint: "", header: "", fields: [], rowsHeader: "", rows: [] });
		// Im Kaskaden-Popover IST der Verlauf der Inhalt, nicht die Beigabe.
		oDetail.setProperty("/logVisible", true);
		/*
		 * Dieselbe Aufbereitung wie im Ladeweg ueber OData - sprechender
		 * Prozess, Systemseite, durchnummeriert. Die Schritte liegen hier
		 * bereits aufsteigend nach SeqNr vor (CascadeGrouper.group), die
		 * Nummer stimmt also mit dem ueberein, was der vollstaendige Weg
		 * zeigen wuerde.
		 */
		oDetail.setProperty("/log", KeyDetailLoader.numberEntries(
			(oRow.Steps ?? []).map((oStep) => {
				const sHist = oStep.HistoryType ?? "";
				return {
					stamp:   this.formatter.timestamp(oStep.CreatedAtStamp),
					no:      "",
					logType: oStep.LogType ?? "",
					message: oStep.Message ?? "",
					process: oBundle.getText("popAttrProcess", [
						sHist ? this.formatter.historyTypeText(sHist) : this.formatter.dashIfEmpty(sHist)
					]) ?? "",
					processRaw: sHist,
					side:    KeyDetailLoader.sideText(sHist, oBundle),
					http:    oStep.HttpStatus ? (oBundle.getText("popAttrHttp", [String(oStep.HttpStatus)]) ?? "") : "",
					line:    oStep.OrderLineNr ? (oBundle.getText("popAttrLine", [oStep.OrderLineNr]) ?? "") : "",
					payload: oStep.JsonPayload ?? ""
				};
			})
		));

		void this._openPopover(oSource);
	}

	/**
	 * Laedt die gefilterten Zeilen und verdichtet sie im Browser.
	 *
	 * Serverseitig geht das nicht: ZLE_AUST_C_APPL_LOG traegt kein
	 * @Aggregation.applySupported, es gibt also kein OData-$apply. Dieselbe
	 * Lage wie beim Verlaufs-Chart, deshalb auch dieselbe Obergrenze und
	 * derselbe Umgang damit - wird sie erreicht, sagt es die Kopfzeile.
	 */
	/**
	 * Schalter "nur offene" der Vorgangssicht.
	 *
	 * Laedt die Vorgaenge neu statt nur zu filtern: der Erledigt-Zustand kommt
	 * aus einer eigenen Abfrage, und beide muessen zueinander passen. Ein
	 * Filter auf einem veralteten Zustand wuerde Zeilen ausblenden, die
	 * inzwischen wieder offen sind.
	 */
	public onOpenOnlyToggle(): void {
		// Gilt jetzt in BEIDEN Sichten: flach als serverseitiger Filter,
		// in der Vorgangssicht als Array-Filter. _applyMsgFilter( ) trifft
		// beides.
		// Prozess/Suche/"Nur offene" gelten auch fuer den Verlauf.
		this._applyMsgFilter(true);
	}

	private async _loadCascades(iGen = 0): Promise<void> {
		const oCascade = this._cascadeModel();
		oCascade.setProperty("/busy", true);
		try {
			const oBinding = this.getODataModel("mainModel").bindList(
				"/AppLog",
				undefined,
				[new Sorter("CreatedAtStamp", true)],
				this._msgFilters(),
				{ $select: "LogUuid,CorrUuid,SeqNr,CreatedAtStamp,LogType,HistoryType,Message,"
					+ "ItemNumber,TpaNumber,OrderLineNr,BusinessKey,KeyType,Lgnum,HttpStatus,"
					+ "JsonPayload,IsResolved",
					// $count kostet keine zweite Abfrage, macht aber aus der
					// Heuristik "genau MAX_ROWS gelesen, also wohl gekappt" eine
					// Tatsache - und liefert die Zahl, die der Anwender wissen
					// will: wie viele es insgesamt sind.
					$count: true }
			);
			/*
			 * 🔴 GELADEN WIRD BIS ZU EINER ZAHL VON VORGAENGEN, NICHT VON
			 * MELDUNGEN.
			 *
			 * Bis 11.09.2026 holte die Sicht 5000 MELDUNGEN, und wie viele
			 * Vorgaenge dabei herauskamen, war Zufall - 4.521 an diesem Tag,
			 * bei anderer Datenlage 3000 oder 5000. Die Oberflaeche spricht
			 * aber konsequent von Vorgaengen; dann darf ihre einzige harte
			 * Grenze nicht in der anderen Einheit stehen.
			 *
			 * Gezaehlt wird ueber CascadeGrouper.operationKey( ) - dieselbe
			 * Funktion, die auch gruppiert. Eine zweite Zaehlregel hier waere
			 * genau die Doppelung, die beim naechsten Anfassen auseinander
			 * laeuft.
			 *
			 * ⚠ Zwei Abbruchgruende, und sie bedeuten Verschiedenes:
			 *   MAX_OPS   das Ziel ist erreicht - Normalfall
			 *   MAX_ROWS  die Meldungen gehen aus, bevor genug Vorgaenge
			 *             beisammen sind. Passiert bei sehr grossen Gruppen
			 *             (Sammellauf) und ist ein eigener Befund.
			 */
			const aRows: CascadeGrouper.LogRow[] = [];
			const oSeen = new Set<string>();
			let bRowLimit = false;
			for (;;) {
				const aChunk = await oBinding.requestContexts(
					aRows.length, CascadeGrouper.CHUNK_ROWS);
				if (aChunk.length === 0) {
					break;
				}
				aChunk.forEach((oCtx) => {
					const oRow = oCtx.getObject() as CascadeGrouper.LogRow;
					oSeen.add(CascadeGrouper.operationKey(oRow, aRows.length));
					aRows.push(oRow);
				});
				if (oSeen.size >= CascadeGrouper.MAX_OPS) {
					break;
				}
				if (aRows.length >= CascadeGrouper.MAX_ROWS) {
					bRowLimit = true;
					break;
				}
				// Kuerzer als angefordert heisst: der Bestand ist erschoepft.
				if (aChunk.length < CascadeGrouper.CHUNK_ROWS) {
					break;
				}
			}

			const nTotal = oBinding.getCount() ?? aRows.length;
			const bTruncated = nTotal > aRows.length;
			const oResult = CascadeGrouper.group(aRows, bTruncated);
			oCascade.setProperty("/rowLimit", bRowLimit);

			/*
			 * Die UNGEFILTERTE Menge wird aufbewahrt, die sichtbare daraus
			 * berechnet. Grund: "Nur offene" haengt seit dem Abgleich mit dem
			 * Arbeitsvorrat an ZWEI Quellen, und die zweite (mapDone) wird
			 * parallel geladen. Ohne die Trennung waere die erste Anzeige
			 * nach dem Start bis zum naechsten Takt falsch - 30 Sekunden
			 * lang.
			 */
			oCascade.setProperty("/allRows", oResult.rows);
			oCascade.setProperty("/sourceCount", oResult.sourceCount);
			oCascade.setProperty("/truncated", bTruncated);
			this._applyOpenOnly();
			oCascade.setProperty("/opsCount", oResult.rows.length);
			oCascade.setProperty("/gen", iGen);
			this._checkTabCount();

			/*
			 * Die Obergrenze bekommt einen eigenen Hinweis statt eines Anhangs
			 * an die Zusammenfassung: "wie viel" und "wie verlaesslich" sind
			 * zwei Aussagen, und die zweite braucht mehr Platz als eine
			 * Klammer. Der Text nennt den Schnittzeitpunkt, der Tooltip die
			 * Zahlen und den Weg heraus.
			 *
			 * Der Schnitt ist wohldefiniert, weil absteigend nach
			 * CreatedAtStamp sortiert wird: der zuletzt gelesene Satz ist der
			 * aelteste, alles davor fehlt.
			 */
			const sCut = bTruncated
				? this.formatter.timestamp(aRows[aRows.length - 1]?.CreatedAtStamp)
				: "";
			oCascade.setProperty("/cutText",
				bTruncated ? (this._bundle().getText("cascCut", [sCut]) ?? "") : "");
			/*
			 * Zwei Erklaerungen, weil zwei verschiedene Dinge passiert sind.
			 * Der Normalfall ist "genug Vorgaenge beisammen"; die Variante
			 * ist "die Meldungen wurden knapp, bevor es so weit war" - und
			 * das ist ein Befund ueber die Daten, kein Deckel der Sicht.
			 */
			oCascade.setProperty("/cutTip",
				bTruncated ? (this._bundle().getText(
					bRowLimit ? "cascCutTipRows" : "cascCutTip", [
						this.formatter.countText(nTotal),
						this.formatter.countText(aRows.length),
						sCut
					]) ?? "") : "");
		} catch {
			oCascade.setProperty("/allRows", []);
			oCascade.setProperty("/rows", []);
			oCascade.setProperty("/truncated", false);
			oCascade.setProperty("/summary", this._bundle().getText("popLoadFailed") ?? "");
		} finally {
			oCascade.setProperty("/busy", false);
		}
	}

	/**
	 * Stimmt die serverseitig gezaehlte Vorgangszahl mit der im Browser?
	 *
	 * 🔴 EINE PRUEFUNG, DIE ES SONST NICHT GAEBE. Die Reiterzahlen kommen aus
	 * $apply=groupby((CorrUuid)) - das laesst sich von aussen nicht
	 * nachrechnen. Fuer den OFFENEN Reiter aber schon: dort liegen dieselben
	 * Zeilen im Browser, unter derselben Filterkette, und CascadeGrouper hat
	 * sie gerade gruppiert. Beide Zahlen muessen uebereinstimmen.
	 *
	 * Tun sie es nicht, ist der wahrscheinlichste Grund bekannt: Zeilen mit
	 * INITIALER CorrUuid fallen serverseitig in EINE Gruppe, waehrend der
	 * Browser jede davon als eigenen Vorgang fuehrt (Altbestand von vor
	 * Michaels Logging-Umbau). Dann zaehlt der Reiter zu niedrig.
	 *
	 * ⚠ Bei erreichter Obergrenze wird NICHT verglichen - der Browser hat
	 * dann weniger Zeilen gesehen als der Server gezaehlt hat, und eine
	 * Abweichung waere erwartbar statt aussagekraeftig.
	 */
	private _checkTabCount(): void {
		if (!KpiLoader.isApplySupported()) {
			return;
		}
		const oUi = this.getUiModel();
		const oCascade = this._cascadeModel();

		/*
		 * 🔴 NUR VERGLEICHEN, WENN BEIDE ZAHLEN ZUM SELBEN FILTERSTAND
		 * GEHOEREN. Ohne diese Pruefung stellte die Warnung am 14.09.2026
		 * die frisch gruppierte Menge gegen einen Reiterzaehler aus dem
		 * VORIGEN Lauf - im Protokoll an den Zahlen ablesbar: 370/249,
		 * dann 249/134, dann 134/370. Dieselben drei Werte, um eins
		 * verschoben. Die Warnung beschuldigte die Daten, obwohl die
		 * Reihenfolge schuld war.
		 */
		const vCascGen = oCascade.getProperty("/gen") as number | undefined;
		const vTabGen = oUi.getProperty("/kpi/gen") as number | undefined;
		if (vCascGen === undefined || vTabGen === undefined || vCascGen !== vTabGen) {
			return;
		}

		/*
		 * ⚠ Bei erreichter Obergrenze wird NICHT verglichen: der Reiter
		 * zaehlt ueber den ganzen Bestand, der Browser nur ueber das
		 * geladene Fenster. Eine Abweichung waere dort erwartbar statt
		 * aussagekraeftig.
		 */
		if ((oCascade.getProperty("/truncated") as boolean) === true) {
			return;
		}

		const sProcess = oUi.getProperty("/selectedProcess") as string;
		const sShown = oUi.getProperty("/kpi/tab" + sProcess) as string;
		const nShown = Number(sShown);
		const nBrowserOps = Number(oCascade.getProperty("/opsCount"));
		if (!sShown || !Number.isFinite(nShown) || !Number.isFinite(nBrowserOps)
				|| nShown === nBrowserOps) {
			return;
		}

		// eslint-disable-next-line no-console
		console.warn(`[Reiterzaehler] ${sProcess}: Server zaehlt ${String(nShown)} `
			+ `Vorgaenge, der Browser ${String(nBrowserOps)}. Beide Zahlen gehoeren `
			+ "zum selben Filterstand - die Abweichung ist also echt.");
	}

	/**
	 * Aus der geladenen Menge die sichtbare machen - Schalter "Nur offene".
	 *
	 * 🔴 ZWEI QUELLEN FUER "ERLEDIGT", und beide muessen greifen:
	 *   IsResolved         die juengste Meldung zum Schluessel ist ein Erfolg
	 *   reproc>/mapDone    der Arbeitsvorrat hat den Satz abgeschlossen
	 *
	 * Ohne die zweite waere der Abgleich halbfertig: der Vorgang traege das
	 * Erledigt-Kennzeichen und stuende trotzdem in einer Liste, die
	 * "nur offene" heisst.
	 *
	 * Wird auch nach dem Laden des Arbeitsvorrats gerufen, weil der parallel
	 * kommt - sonst zeigte die erste Anzeige nach dem Start eine Menge, die
	 * schon beim naechsten Takt eine andere waere.
	 */
	private _applyOpenOnly(): void {
		const oCascade = this._cascadeModel();
		const aAll = (oCascade.getProperty("/allRows") ?? []) as CascadeGrouper.CascadeRow[];
		const oDone = (this._jsonModel("reproc", { map: {} }).getProperty("/mapDone")
			?? {}) as Record<string, unknown[]>;

		let aRowsOut = aAll;
		if (this.getUiModel().getProperty("/openOnly") as boolean) {
			aRowsOut = aAll.filter((oRow) => {
				if ((oRow.IsResolved ?? "").trim().toUpperCase() === "X") {
					return false;
				}
				const sKey = (oRow.BusinessKey ?? "").trim();
				return !(sKey && (oDone[sKey]?.length ?? 0) > 0);
			});
		}

		oCascade.setProperty("/rows", aRowsOut);

		/*
		 * 🔴 aRowsOut.length, NICHT die ungefilterte Zahl.
		 *
		 * Bis 11.09.2026 nannte die Zusammenfassung die Zahl VOR dem Filter
		 * "Nur offene", waehrend die Tabelle die gefilterte Menge zeigte.
		 * Weil der Schalter standardmaessig an ist, stimmten die beiden
		 * Zahlen praktisch nie ueberein - und die sichtbare war die falsche.
		 */
		/*
		 * NUR DIE VORGAENGE (Festlegung Tolksdorf, 11.09.2026). Vorher stand
		 * hier "425 Meldungen -> 364 Vorgaenge" - beide Zahlen nebeneinander,
		 * und der Anwender musste sich aussuchen, welche gilt. Es gilt die
		 * zweite: sie beschreibt, was in der Tabelle steht.
		 *
		 * Die Meldungszahl ist nicht verloren, sie steht im Tooltip. Dort ist
		 * sie das, was sie ist - eine Hintergrundinformation ueber die
		 * Verdichtung, keine konkurrierende Hauptzahl.
		 */
		const nSource = (oCascade.getProperty("/sourceCount") ?? 0) as number;

		/*
		 * BEI GEKAPPTER SICHT NENNT DIE ZEILE BEIDE ZAHLEN.
		 *
		 * Reiter und Zusammenfassung zaehlen verschiedene Mengen: der Reiter
		 * den GANZEN Bestand, die Tabelle nur die neuesten Meldungen. Beide
		 * Zahlen sind damit richtig - aber nebeneinander ohne Bezug laden sie
		 * zu der Frage ein, die am 11.09.2026 auch prompt kam ("warum ist da
		 * eine Diskrepanz?"). "4.521 von 6.923 Vorgaengen" beantwortet sie,
		 * bevor sie entsteht.
		 *
		 * ⚠ Nur wenn der Reiter wirklich VORGAENGE zaehlt. Ist der Zaehler
		 * auf Meldungen zurueckgefallen, waere "von 7.402 Vorgaengen" schlicht
		 * gelogen - dann bleibt es bei der einen Zahl.
		 */
		const sTotal = this.getUiModel().getProperty(
			"/kpi/tab" + (this.getUiModel().getProperty("/selectedProcess") as string)) as string;
		const nTotal = Number(sTotal);
		const bShowBoth = (oCascade.getProperty("/truncated") as boolean) === true
			&& KpiLoader.isApplySupported()
			&& Number.isFinite(nTotal) && nTotal > aRowsOut.length;

		oCascade.setProperty("/summary", (bShowBoth
			? this._bundle().getText("cascSummaryOf", [
				this.formatter.countText(aRowsOut.length),
				this.formatter.countText(nTotal)
			])
			: this._bundle().getText("cascSummary", [
				this.formatter.countText(aRowsOut.length)
			])) ?? "");
		oCascade.setProperty("/summaryTip", this._bundle().getText(
			"cascSummaryTip", [
				this.formatter.countText(nSource),
				this.formatter.countText(aRowsOut.length)
			]) ?? "");
	}

	/**
	 * Hinweise zur Bedienung, am Info-Symbol der Kopfzeile.
	 *
	 * Traegt die Erklaerung, die vorher als Tooltip am Aktualisierungsschalter
	 * hing. Ein Tooltip beschriftet ein Steuerelement - er ist der falsche Ort
	 * fuer drei Saetze, weil man ihn wegklickt statt ihn zu lesen und er beim
	 * Ueberfahren die Kopfzeile verdeckt.
	 */
	public async onInfoPress(oEvent: Event): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		if (!this._pInfoPopover) {
			this._pInfoPopover = Fragment.load({
				id: this.getView()?.getId(),
				name: "zui5_zle_aust_mon.view.fragment.InfoPopover",
				controller: this
			}) as Promise<Popover>;
			void this._pInfoPopover.then((oPopover) => this.getView()?.addDependent(oPopover));
		}
		(await this._pInfoPopover).openBy(oSource);
	}

	public onInfoClose(): void {
		void this._pInfoPopover?.then((oPopover) => oPopover.close());
	}

	/** Erzeugt das Detail-Popover einmalig und oeffnet es am geklickten Element. */
	private async _openPopover(oSource: Control): Promise<void> {
		if (!this._pKeyPopover) {
			this._pKeyPopover = Fragment.load({
				id: this.getView()?.getId(),
				name: "zui5_zle_aust_mon.view.fragment.KeyPopover",
				controller: this
			}) as Promise<Popover>;
			void this._pKeyPopover.then((oPopover) => this.getView()?.addDependent(oPopover));
		}
		const oPopover = await this._pKeyPopover;
		oPopover.openBy(oSource);
	}

	private _cascadeModel(): JSONModel {
		let oModel = this.getView()?.getModel("cascade") as JSONModel | undefined;
		if (!oModel) {
			oModel = new JSONModel({ rows: [], summary: "", truncated: false });
			this.getView()?.setModel(oModel, "cascade");
		}
		return oModel;
	}

	/**
	 * URL -> Modell. Laeuft bei jedem Aufruf der Route, also auch beim
	 * Zurueck-Knopf des Browsers.
	 */
	private _onRouteMatched(oEvent: Event): void {
		const oArgs = (oEvent.getParameter("arguments" as never) ?? {}) as Record<string, unknown>;
		const oQuery = (oArgs["?query"] ?? {}) as Record<string, string>;
		const oUi = this.getUiModel();

		this._bApplyingUrl = true;
		Object.entries(Main.URL_KEYS).forEach(([sKey, sPath]) => {
			const sValue = oQuery[sKey];
			if (sValue === undefined) {
				return;
			}
			if (Main.URL_BOOLEANS.includes(sPath)) {
				/*
				 * 🔴 Ausdruecklich boolean, nicht der Rohtext. Bis 01.09.2026
				 * fiel "/openOnly" in den else-Zweig und landete als STRING im
				 * Modell - "?o=0" haette den Filter damit EINGESCHALTET, weil
				 * "0" truthy ist. Aufgefallen ist es nie, weil _syncUrl den
				 * Schluessel gar nicht schrieb.
				 */
				oUi.setProperty(sPath, sValue === "1");
			} else if (sPath === "/chartDays") {
				/*
				 * Durchgehend als STRING ablegen. selectedKey des
				 * SegmentedButton ist eine String-Eigenschaft: UI5 wandelt
				 * eine Zahl beim Setzen zwar still um, die Zwei-Wege-Bindung
				 * schreibt beim Klick aber einen String zurueck. Der
				 * Modellwert wechselte damit je nach Herkunft den Typ - genau
				 * die Sorte Unsauberkeit, die spaeter an einem === auffaellt.
				 * Gelesen wird ohnehin ueberall mit Number( ).
				 */
				oUi.setProperty(sPath, String(Number(sValue) || Main.CHART_DAYS));
			} else if (sPath === "/selectedDay") {
				/*
				 * Zweite Pruefung, absichtlich doppelt zur der in
				 * _msgFilters( ): hier faellt ein unbrauchbarer Wert gar nicht
				 * erst ins Modell und kann dort auch nicht in einen Chip oder
				 * in die zurueckgeschriebene Adresse geraten. Die Pruefung im
				 * Filter bleibt trotzdem stehen - sie ist die, die den
				 * $batch schuetzt, und sie darf nicht davon abhaengen, dass
				 * jeder Schreiber sich vorher benimmt.
				 */
				oUi.setProperty(sPath, /^\d{4}-\d{2}-\d{2}$/.test(sValue) ? sValue : "");
			} else {
				oUi.setProperty(sPath, sValue);
			}
		});
		this._bApplyingUrl = false;

		this._applyMsgFilter();
		// Kam ein abweichendes Zeitfenster aus der Adresse, muss der Chart
		// nachziehen - _applyMsgFilter betrifft nur die Tabelle.
		if (Number(oUi.getProperty("/chartDays")) !== Main.CHART_DAYS) {
			void this._loadChart();
		}
	}

	/**
	 * Modell -> URL.
	 *
	 * ⚠ replace: true, KEIN neuer Eintrag in der Chronik. Sonst legte jeder
	 * Klick auf einen Reiter einen Verlaufsschritt an, und der
	 * Zurueck-Knopf braeuchte ein Dutzend Betaetigungen, um die App zu
	 * verlassen.
	 *
	 * ⚠ Standardwerte fallen aus der URL heraus. Eine Adresse mit vier
	 * Parametern, von denen drei nichts aussagen, laedt niemanden zum
	 * Weiterschicken ein.
	 */
	private _syncUrl(): void {
		if (this._bApplyingUrl) {
			return;
		}
		const oUi = this.getUiModel();
		const oQuery: Record<string, string> = {};

		const sProcess = oUi.getProperty("/selectedProcess") as string;
		if (sProcess && sProcess !== ProcessAxis.KEY_DEFAULT) {
			oQuery.p = sProcess;
		}
		const sType = oUi.getProperty("/selectedType") as string;
		if (sType) {
			oQuery.t = sType;
		}
		const sSearch = oUi.getProperty("/searchTerm") as string;
		if (sSearch) {
			oQuery.q = sSearch;
		}
		const sDay = oUi.getProperty("/selectedDay") as string;
		if (sDay) {
			oQuery.dt = sDay;
		}
		// ⚠ Geschrieben wird die ABWEICHUNG vom Standard, nicht der wahre
		// Wert. "o" wurde bis 01.09.2026 GAR NICHT geschrieben, obwohl es in
		// URL_KEYS steht und gelesen wird - ein Zustand, der nur in eine
		// Richtung floss. Mit dem Standard "nur offene" waere das Ausschalten
		// sonst nach jedem Neuladen wieder weg.
		const bOpenOnly = oUi.getProperty("/openOnly") as boolean;
		if (bOpenOnly !== ViewDefaults.OPEN_ONLY_DEFAULT) {
			oQuery.o = bOpenOnly ? "1" : "0";
		}
		const nDays = Number(oUi.getProperty("/chartDays"));
		if (nDays && nDays !== Main.CHART_DAYS) {
			oQuery.d = String(nDays);
		}

		(this.getOwnerComponent() as UIComponent).getRouter().navTo(
			"RouteMain",
			Object.keys(oQuery).length ? { "?query": oQuery } : {},
			true
		);
	}
}
