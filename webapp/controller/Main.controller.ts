import DateFormat from "sap/ui/core/format/DateFormat";
import Table from "sap/ui/table/Table";
import BaseController from "./BaseController";
import * as TableColumnState from "../util/TableColumnState";

/**
 * @namespace zui5_zle_aust_mon.controller
 */
export default class Main extends BaseController {

	/**
	 * Standardmaessig sichtbare Spaltenanzahl je Tabelle. Der Rest ist
	 * ausgeblendet und laesst sich ueber das Zahnrad im Panel-Header
	 * einblenden.
	 */
	private static readonly DEFAULT_VISIBLE: Record<string, number> = {
		idAppLogTable: 4,
		idTpaTable: 8
	};

	public onInit(): void {
		this._stampRefresh();
		Object.keys(Main.DEFAULT_VISIBLE).forEach((sTableId) => {
			const oTable = this._table(sTableId);
			if (oTable) {
				TableColumnState.restore(oTable, sTableId, Main.DEFAULT_VISIBLE[sTableId]);
			}
		});
	}

	public onRefresh(): void {
		this._stampRefresh();
		Object.keys(Main.DEFAULT_VISIBLE).forEach((sTableId) => {
			this._table(sTableId)?.getBinding("rows")?.refresh();
		});
	}

	public onOpenAppLogColumns(): void {
		this._openColumns("idAppLogTable");
	}

	public onOpenTpaColumns(): void {
		this._openColumns("idTpaTable");
	}

	private _table(sTableId: string): Table | undefined {
		return this.byId(sTableId) as Table | undefined;
	}

	private _openColumns(sTableId: string): void {
		const oTable = this._table(sTableId);
		if (oTable) {
			TableColumnState.openDialog(oTable, sTableId);
		}
	}

	/**
	 * Schreibt den aktuellen Zeitpunkt in das ui-Modell. Bewusst hier und nicht
	 * als Expression Binding in der View: dort waere der Wert nicht reaktiv
	 * und nicht testbar.
	 */
	private _stampRefresh(): void {
		const oFormat = DateFormat.getDateTimeInstance({ style: "medium" });
		this.getUiModel().setProperty("/lastRefreshText", oFormat.format(new Date()));
	}
}
