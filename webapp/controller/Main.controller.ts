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
		d: "/chartDays"
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
		this._applyMsgFilter();
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
		if (!sKey) {
			return;
		}

		const oModel = this._jsonModel("reproc", { map: {} });
		const oMap = (oModel.getProperty("/map") ?? {}) as Record<string, ReprocLookup.ReprocEntry[]>;
		oModel.setProperty("/entries", oMap[sKey] ?? []);
		oModel.setProperty("/title", this._bundle().getText("reprocPopTitle", [sKey]) ?? sKey);

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
		oJson.setProperty("/entries", oNew[sKey] ?? []);
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
		this._applyMsgFilter();
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
	private _applyMsgFilter(): void {
		// Alle vier Zustaende laufen hier zusammen - ein Anschlusspunkt
		// genuegt, statt ihn in jeden Handler einzeln zu haengen.
		this._syncUrl();

		// Es gibt nur noch die Vorgangssicht (Festlegung Maring, 03.09.2026).
		// Die flache, serverseitig geblaetterte Meldungstabelle ist entfallen -
		// ein Ereignis ist eine Zeile, die Einzelschritte stehen dahinter.
		void this._loadCascades();
	}

	/**
	 * Prozess- und Typfilter als Filterliste.
	 *
	 * Ausgelagert, weil sie zweimal gebraucht wird: fuer die OData-Bindung
	 * der Tabelle und fuer den Ladevorgang der Vorgangs-Verdichtung. Zwei
	 * Kopien wuerden auseinanderlaufen, und dann zeigte die gruppierte
	 * Sicht etwas anderes als die einzelne.
	 */
	private _msgFilters(): Filter[] {
		const sProcess = this.getUiModel().getProperty("/selectedProcess") as string;
		const sType = this.getUiModel().getProperty("/selectedType") as string;
		const aFilters: Filter[] = [];

		if (sProcess === ProcessAxis.KEY_UNASSIGNED) {
			aFilters.push(ProcessAxis.unassignedFilter());
		} else if (sProcess !== ProcessAxis.KEY_ALL && sProcess !== ProcessAxis.KEY_ORDERS) {
			const oProcess = ProcessAxis.processFilter(sProcess);
			if (oProcess) {
				aFilters.push(oProcess);
			}
		}

		if (sType) {
			aFilters.push(new Filter({
				path: "LogType", operator: FilterOperator.EQ, value1: sType
			}));
		}

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
		oModel.setProperty("/total", oResult.total);
		oModel.setProperty("/truncated", oResult.truncated);
		oModel.setProperty("/ok", oResult.ok);
	}

	private async _loadChart(): Promise<void> {
		try {
			const oData = await LogAggregator.loadLastDays(
				this.getODataModel("mainModel"),
				Number(this.getUiModel().getProperty("/chartDays")) || Main.CHART_DAYS
			);
			(this.getView()?.getModel("chart") as JSONModel).setData(oData);
			this.getUiModel().setProperty("/chartTruncated", oData.truncated);
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
				categoryAxis: { title: { visible: false } }
			});
		});
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
		sTpaField: string
	): Promise<void> {
		// oEvent.getSource( ) liefert laut Typen EventProvider, dort gibt es
		// weder getBindingContext noch laesst es sich an openBy uebergeben.
		// Die Assertion ist also noetig - tsc belegt das, ESLints Regel
		// no-unnecessary-type-assertion urteilt hier falsch.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;

		/*
		 * Der Schluessel wird in ALLEN drei Modellen gesucht, weil dieselben
		 * Handler aus drei Tabellen gerufen werden:
		 *   idCascadeTable  -> cascade    (JSON, verdichtete Vorgaenge)
		 *   idCascadeTable  -> cascade    (JSON, verdichtete Vorgaenge)
		 *   idTpaTable      -> tpaModel   (OData, Auftragspuffer)
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
			{ model: "mainModel", field: sMainField, hasLogFields: true },
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

	/** Alle Schritte eines Vorgangs - im selben Popover wie die Detailsicht. */
	/**
	 * Alle Meldungen desselben Vorgangs - aus der Datenbank, nicht aus dem
	 * Speicher.
	 *
	 * 🔴 NICHT DASSELBE WIE DIE SPALTE "SCHRITTE", und genau deshalb gibt es
	 * beides. Ich hatte das am 03.09.2026 einmal als Dopplung entfernt - das
	 * war falsch:
	 *
	 *   Schritte  zeigt die im Browser GELADENEN und gruppierten Schritte.
	 *             Gedeckelt bei CascadeGrouper.MAX_ROWS (5000 Meldungen) und
	 *             bei Sammellaeufen zusaetzlich bei MAX_STEPS (25).
	 *   hier      fragt OData nach der CorrUuid und zeigt ALLE Meldungen des
	 *             Vorgangs - auch die, die ausserhalb des geladenen Fensters
	 *             liegen.
	 *
	 * Liegt ein Vorgang teils jenseits der 5000er-Grenze, zeigt die
	 * Schritte-Ansicht also einen Ausschnitt und diese hier das Ganze.
	 */
	public onCorrPress(oEvent: Event): void {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		const sCorr = String(oSource.getBindingContext("cascade")?.getProperty("CorrUuid") ?? "").trim();
		if (!sCorr) {
			return;
		}
		void this._openCorrPopover(oSource, sCorr);
	}

	public onCascadePress(oEvent: Event): void {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		const oContext = oSource.getBindingContext("cascade");
		const oRow = oContext?.getObject() as CascadeGrouper.CascadeRow | undefined;
		if (!oRow) {
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
		oDetail.setProperty("/log", (oRow.Steps ?? []).map((oStep) => ({
			stamp:   this.formatter.timestamp(oStep.CreatedAtStamp),
			logType: oStep.LogType ?? "",
			message: oStep.Message ?? "",
			process: oBundle.getText("popAttrProcess", [this.formatter.dashIfEmpty(oStep.HistoryType)]) ?? "",
			http:    oStep.HttpStatus ? (oBundle.getText("popAttrHttp", [String(oStep.HttpStatus)]) ?? "") : "",
			line:    oStep.OrderLineNr ? (oBundle.getText("popAttrLine", [oStep.OrderLineNr]) ?? "") : "",
			payload: oStep.JsonPayload ?? ""
		})));

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
		this._applyMsgFilter();
	}

	private async _loadCascades(): Promise<void> {
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
					+ "JsonPayload,IsResolved" }
			);
			const aContexts = await oBinding.requestContexts(0, CascadeGrouper.MAX_ROWS);
			const aRows = aContexts.map((oCtx) => oCtx.getObject() as CascadeGrouper.LogRow);
			const oResult = CascadeGrouper.group(aRows, aRows.length >= CascadeGrouper.MAX_ROWS);

			// "Nur offene": erledigte Vorgaenge herausnehmen. Der Zustand steht
			// "Nur offene": erledigte Vorgaenge herausnehmen. IsResolved kommt
			// jetzt mit der Zeile aus dem Service - kein zweiter Ladevorgang
			// und keine Reihenfolgefrage mehr.
			let aRowsOut = oResult.rows;
			if (this.getUiModel().getProperty("/openOnly") as boolean) {
				aRowsOut = aRowsOut.filter(
					(oRow) => (oRow.IsResolved ?? "").trim().toUpperCase() !== "X"
				);
			}

			oCascade.setProperty("/rows", aRowsOut);
			oCascade.setProperty("/sourceCount", oResult.sourceCount);
			oCascade.setProperty("/truncated", oResult.truncated);
			oCascade.setProperty("/summary", this._bundle().getText(
				oResult.truncated ? "cascSummaryCut" : "cascSummary",
				// Meldungen zuerst: diese Zahl entspricht dem, was der
				// Reiter ohne Gruppierung anzeigt - so ist der Bezug
				// erkennbar, statt dass zwei Zahlen unverbunden nebeneinander
				// stehen.
				[String(oResult.sourceCount), String(oResult.rows.length)]
			) ?? "");
		} catch {
			oCascade.setProperty("/rows", []);
			oCascade.setProperty("/summary", this._bundle().getText("popLoadFailed") ?? "");
		} finally {
			oCascade.setProperty("/busy", false);
		}
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
