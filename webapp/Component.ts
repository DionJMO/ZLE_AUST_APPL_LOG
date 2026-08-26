import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import Device from "sap/ui/Device";

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
			selectedProcess: "IB",
			selectedType: "",
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
			}
		}), "ui");

		this.getRouter().initialize();
	}
}
