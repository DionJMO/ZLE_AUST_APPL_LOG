import DateFormat from "sap/ui/core/format/DateFormat";
import JSONModel from "sap/ui/model/json/JSONModel";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import BaseController from "./BaseController";
import * as TaskAggregator from "../model/TaskAggregator";

/**
 * Arbeitsliste fuer den Fachbereich.
 *
 * Bewusst KEINE Protokollsicht: eine Zeile je betroffenem Material,
 * nicht je Meldung, und ausschliesslich das, was der Fachbereich
 * selbst loesen kann. Technische Fehler bleiben im Monitoring
 * (Route RouteMain).
 *
 * Zielzustand dieser Seite ist LEER. Der leere Fall ist deshalb keine
 * blanke Tabelle, sondern eine Bestaetigung - siehe Tasks.view.xml.
 *
 * Die Klartexte werden HIER aufgeloest und nicht per Formatter in der
 * View: ein Formatter hat keinen Zugriff auf das ResourceBundle, und
 * die Texte gehoeren in die i18n-Datei, nicht in den Code.
 *
 * @namespace zui5_zle_aust_mon.controller
 */
export default class Tasks extends BaseController {

	/** Zeitfenster der Arbeitsliste in Tagen. */
	private static readonly TASK_DAYS = 7;

	public onInit(): void {
		this.getView()?.setModel(
			new JSONModel({ items: [], others: [], hasContent: false, truncated: false }),
			"tasks"
		);
		void this._loadTasks();
	}

	public onRefresh(): void {
		void this._loadTasks();
	}

	private _bundle(): ResourceBundle {
		const oModel = this.getOwnerComponent()?.getModel("i18n") as ResourceModel;
		return oModel.getResourceBundle() as ResourceBundle;
	}

	/**
	 * Problemklasse in Klartext und Handlungsanweisung uebersetzen.
	 * Unbekannte Klassen fallen auf die Originalmeldung zurueck - ein
	 * technischer Text ist besser als ein falscher fachlicher.
	 */
	private _describe(oItem: TaskAggregator.TaskItem): TaskAggregator.TaskItem & {
		problemText: string;
		actionText: string;
	} {
		const oBundle = this._bundle();
		const sProblem = oBundle.getText("problem" + oItem.problemKey) ?? "";
		const sAction = oBundle.getText("action" + oItem.problemKey) ?? "";
		const bKnown = sProblem !== "problem" + oItem.problemKey;

		return {
			...oItem,
			problemText: bKnown ? sProblem : oItem.sample,
			actionText: bKnown ? sAction : (oBundle.getText("actionOTHER") ?? "")
		};
	}

	private async _loadTasks(): Promise<void> {
		const oFormat = DateFormat.getDateTimeInstance({ style: "medium" });
		this.getUiModel().setProperty("/lastRefreshText", oFormat.format(new Date()));

		try {
			const oData = await TaskAggregator.loadOpenTasks(
				this.getODataModel("mainModel"),
				Tasks.TASK_DAYS
			);
			(this.getView()?.getModel("tasks") as JSONModel).setData({
				...oData,
				items: oData.items.map((oItem) => this._describe(oItem))
			});
		} catch (oError) {
			// eslint-disable-next-line no-console
			console.error("[Arbeitsliste] Laden fehlgeschlagen:", oError);
		}
	}
}
