sap.ui.define([], function () {
	"use strict";

	var METRICS = [
		{ id: "idGesamtNumericContent", model: "tpaModel", path: "/Tpa", select: "OrderNumber", filter: null },
		{ id: "idOffenNumericContent", model: "tpaModel", path: "/Tpa", select: "OrderNumber", filter: "OrderStatus ne 'Finished' and OrderStatus ne 'Cancelled'" },
		{ id: "idFehlerNumericContent", model: "mainModel", path: "/AppLog", select: "LogUuid", filter: "LogType eq 'E'" },
		{ id: "idAbbruecheNumericContent", model: "tpaModel", path: "/Tpa", select: "OrderNumber", filter: "OrderStatus eq 'Cancelled'" }
	];

	function loadCount(oView, oDef) {
		var oModel = oView.getModel(oDef.model);
		if (!oModel) { return Promise.resolve(0); }
		var mParams = { $select: oDef.select, $count: true };
		if (oDef.filter) { mParams.$filter = oDef.filter; }
		var oBinding = oModel.bindList(oDef.path, null, [], undefined, mParams);
		return oBinding.requestContexts(0, 1).then(function () {
			return oBinding.getCount() || 0;
		});
	}

	return {

		onAfterRendering: function () {
			if (this._zleKpiLoaded) { return; }
			this._zleKpiLoaded = true;

			var that = this;
			var oView = this.getView();

			METRICS.forEach(function (oDef) {
				loadCount(oView, oDef).then(function (nCount) {
					var oControl = that.byId(oDef.id);
					if (oControl) { oControl.setValue(String(nCount)); }
				}).catch(function (e) {
					// eslint-disable-next-line no-console
					console.error("[KPI] Fehler beim Laden von", oDef.id, ":", e);
				});
			});
		}
	};
});
