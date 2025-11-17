// frappe.ui.form.on('Cargo Stock Receipt', {
//     refresh: function(frm){
//     	frm.trigger("status");
//     	frm.trigger("source");
//     	if (frm.doc.items){
//     		frm.doc.items.forEach(function(row){
//     			total_qty += flt(row.package_qty);
//     			total_gross += flt(row.gross_weight);
//     			total_net += flt(row.net_weight);
//     		});
//     	}

//     	// setting the calculated values on the parent form
//     	frm.set_value('total_packages', total_qty);
//     	frm.set_value('total_gross_weight', total_gross);
//     	frm.set_value('total_net_weight', total_net);

//     	// Calculate and set the 'tonnes' field
//     	frm.set_value('total_net_weight_tonnes', flt(total_net / 1000));

//     	// Refresh the read-only fields to show the new totals
//     	frm.refresh_fields(['total_packages', 'total_gross_weight', 'total_net_weight', 'total_net_weight_tonnes']);       
//     }
// });

// frappe.ui.form.on('Cargo Stock Receipt Item',{
// 	/**
// 	 * riggers row calculation when 'package_qty' changes
// 	*/
// 	package_qty:function(frm, cdt, cdn){
// 	 	frm.trigger("calculate_row_weights", cdt, cdn);
// 	},
// 	/**
// 	 * riggers row calculation when 'unit_weight' changes
// 	*/
// 	unit_weight:function(frm,cdt, cdn){
// 		frm.trigger("calculate_row_weights", cdt, cdn);
// 	},
// 	/**
//      * Calculates the 'gross_weight' and 'net_weight' for a single row
//     */
//     calculate_row_weights: function(frm, cdt, cdn){
//     	let row = frappe.get_doc(cdt, cdn);
//     	let weight = 0;

//     	if(row.package_qty && row.unit_weight){
//     		weight = flt(row.package_qty) * flt(row.unit_weight);
//     	}

//     	frappe.model.set_value(cdt, cdn, 'gross_weight', weight);
//     	frappe.model.set_value(cdt, cdn, 'net_weight', weight);
//     },
//     /**
//      * When 'gross_weight' is changed (by the function above),
//      * it triggers the parent 'calculate_totals' function.
//     */
//     gross_weight: function(frm){
//     	frm.trigger("calculate_totals");
//     },
//     /**
//      * When 'net_weight' is changed (by the function above),
//      * it triggers the parent 'calculate_totals' function.
//     */
//     net_weight: function(frm){
//     	frm.trigger("calculate_totals");
//     }

// });


// Client Script for Cargo Stock Receipt (Option 2)
// Features:
// - Row weight calc (package_qty * unit_weight) -> gross_weight & net_weight
// - Parent totals (packages, gross, net, tonnes)
// - Auto-fill package type & unit weight via server get_item
// - Auto-fill item/warehouse/package type via server get_batch_details
// - Basic validations with popups on before_save
// - Dashboard headlines for this customer
// - Quick Submit (calls whitelisted submit_tit) and Cancel & Remove Stock helper

// ---------------------------
// Helper: compute_totals
// ---------------------------
function compute_totals(frm) {
    let total_packages = 0;
    let total_gross = 0;
    let total_net = 0;

    (frm.doc.items || []).forEach(row => {
        total_packages += flt(row.package_qty || 0);
        total_gross += flt(row.gross_weight || 0);
        total_net += flt(row.net_weight || 0);
    });

    frm.set_value('total_packages', total_packages);
    frm.set_value('total_gross_weight', total_gross);
    frm.set_value('total_net_weight', total_net);
    frm.set_value('total_net_weight_tonnes', flt(total_net / 1000));

    // refresh fields
    frm.refresh_fields([
        'total_packages',
        'total_gross_weight',
        'total_net_weight',
        'total_net_weight_tonnes'
    ]);
}

// ---------------------------
// Form events
// ---------------------------
frappe.ui.form.on('Cargo Stock Receipt', {
    refresh(frm) {
        // set queries / field properties (keeps your existing filters)
        frm.set_query('customer', function () {
            return {
                filters: [['customer_category', '=', 'General Cargo']],
            };
        });

        frm.set_query('item', function () {
            return {
                filters: [
                    ['item_group', '=', 'General Cargo'],
                    ['has_variants', '=', 0],
                    ['Item Customer Detail', 'customer_name', 'in', frm.doc.customer],
                    ['Item Customer Detail', 'customer_name', '!=', ''],
                ],
            };
        });

        frm.set_query('batch', function () {
            return {
                filters: [
                    ['item', '!=', 'TEA'],
                    ['batch_qty', '>', 0],
                    ['customer', '=', frm.doc.customer],
                ],
            };
        });

        frm.set_df_property('item', 'read_only', 1);

        frm.set_query('item', 'items', function (doc, cdt, cdn) {
            return {
                filters: [
                    ['item_group', '=', 'General Cargo'],
                    ['has_variants', '=', 0],
                    ['customer', '=', frm.doc.customer],
                ],
            };
        });

        frm.set_query('transporter', function () {
            return {
                filters: [['is_transporter', '=', 1]],
            };
        });

        frm.set_query('set_warehouse', function () {
            return {
                filters: [['is_group', '=', 0]],
            };
        });

        // compute totals on refresh
        compute_totals(frm);

        // dashboard: quick stats for customer
        frm.trigger('load_dashboard_data');

        // add custom buttons (only when doc exists and not submitted/cancelled)
        if (!frm.is_new() && frm.doc.docstatus === 0) {
            // Quick Submit - uses your whitelisted server method 'submit_tit'
            if (!frm.page.has_quick_submit) {
                frm.add_custom_button(__('Quick Submit'), function () {
                    // run basic validation first
                    if (!basic_client_validation(frm)) return;
                    frappe.confirm(
                        __('Are you sure you want to submit this Cargo Stock Receipt?'),
                        function () {
                            frappe.call({
                                method: 'warehousing.warehousing.doctype.cargo_stock_receipt.cargo_stock_receipt.submit_tit',
                                args: { name: frm.doc.name },
                                freeze: true,
                                freeze_message: __('Submitting...'),
                                callback: function (r) {
                                    if (!r.exc) {
                                        frappe.msgprint(__('Submitted successfully'));
                                        // reload
                                        frm.reload_doc();
                                    }
                                }
                            });
                        }
                    );
                });
                frm.page.has_quick_submit = true;
            }

            // Cancel & Remove Stock button (calls server to cancel stock entry & sales orders, then cancel doc)
            if (!frm.page.has_cancel_remove) {
                frm.add_custom_button(__('Cancel & Remove Stock'), function () {
                    frappe.confirm(
                        __('This will cancel related Stock Entry and Sales Orders then cancel this document. Continue?'),
                        function () {
                            frappe.call({
                                method: 'warehousing.warehousing.doctype.cargo_stock_receipt.cargo_stock_receipt.remove_stock_entry',
                                args: {
                                    items: frm.doc.items,
                                    sb_bundle: frm.doc.serial_and_batch_bundle,
                                    stock_entry_reference: frm.doc.stock_entry_reference
                                },
                                freeze: true,
                                freeze_message: __('Removing stock entry...'),
                                callback: function (r) {
                                    // proceed to cancel the document in the client
                                    frm.cancel_action && frm.cancel_action(); // older API support
                                    frm.cancel && frm.cancel();
                                },
                                error: function() {
                                    frappe.msgprint(__('Failed to remove stock entry. Please check server logs.'));
                                }
                            });
                        }
                    );
                }, __('Actions'));
                frm.page.has_cancel_remove = true;
            }
        }
    },

    // before_save will run on client side BEFORE sending to server.
    // We perform lightweight client-side checks here. Critical validation MUST be on server.
    before_save(frm) {
        // ensure totals calculated
        compute_totals(frm);

        // required: if status == 'Existing', batch must be selected
        if (frm.doc.status === 'Existing' && !frm.doc.batch) {
            frappe.msgprint({
                title: __('Validation'),
                indicator: 'red',
                message: __('Status is "Existing" — please select an existing Batch / Consignment.')
            });
            frappe.validated = false;
            return;
        }

        // Ensure items present
        if (!frm.doc.items || frm.doc.items.length === 0) {
            frappe.msgprint({
                title: __('Validation'),
                indicator: 'red',
                message: __('Please add at least one Received Item.')
            });
            frappe.validated = false;
            return;
        }

        // basic totals sanity check: total_packages should equal dn_package_qty if provided
        if (frm.doc.dn_package_qty && frm.doc.total_packages !== frm.doc.dn_package_qty) {
            frappe.msgprint({
                title: __('Validation'),
                indicator: 'orange',
                message: __('Total packages ({0}) does not match No of Packages on DN ({1}). Verify before saving.', [frm.doc.total_packages, frm.doc.dn_package_qty])
            });
            // do not block save, just warn (change as needed)
        }

        // NOTE: price list/service-item validations are important and should be implemented on the server-side `validate` or `before_submit`.
        // We only do a soft client-side check here (optional).
    },

    // optional: load dashboard data (shows receipts & sum weight for current customer)
    load_dashboard_data(frm) {
        if (!frm.doc.customer) {
            // clear dashboard if no customer
            frm.dashboard.reset();
            frm.dashboard.show();
            return;
        }

        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Cargo Stock Receipt',
                filters: { customer: frm.doc.customer },
                fields: ['name', 'total_net_weight'],
                limit_page_length: 1000
            },
            callback: function (r) {
                if (!r || !r.message) return;
                let total_receipts = r.message.length;
                let total_weight = 0;
                r.message.forEach(function (d) { total_weight += flt(d.total_net_weight || 0); });

                // Show in dashboard
                frm.dashboard.reset();
                frm.dashboard.add_headline(__('<b>Total Receipts:</b> {0}', [total_receipts]));
                frm.dashboard.add_headline(__('<b>Total Weight (kg):</b> {0}', [total_weight]));
                frm.dashboard.show();
            }
        });
    }

});

// ---------------------------
// Child table: Cargo Stock Receipt Item
// ---------------------------
frappe.ui.form.on('Cargo Stock Receipt Item', {
    refresh(frm) {
        // child-level field queries
        frm.set_query('item', function () {
            return {
                filters: [
                    ['item_group', '=', 'General Cargo'],
                    ['has_variants', '=', 0],
                    ['customer', '=', frm.doc.customer],
                ],
            };
        });
        frm.set_query('batch_reference', function () {
            return {
                filters: [
                    ['item', '!=', 'TEA'],
                    ['batch_qty', '>', 0],
                    ['customer', '=', frm.doc.customer],
                ],
            };
        });
        frm.set_query('warehouse', function () {
            return {
                filters: [['is_group', '=', 0]],
            };
        });
    },

    // when a row is added, pre-fill defaults from parent
    items_add(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (frm.doc.status === 'Existing' && frm.doc.batch) {
            frappe.model.set_value(cdt, cdn, 'batch_reference', frm.doc.batch);
        }

        frappe.model.set_value(cdt, cdn, 'item', frm.doc.item || '');
        frappe.model.set_value(cdt, cdn, 'package_type', frm.doc.set_package_type || '');
        frappe.model.set_value(cdt, cdn, 'unit_weight', frm.doc.dn_package_weight || 0);
        frappe.model.set_value(cdt, cdn, 'warehouse', frm.doc.set_warehouse || '');
        frappe.model.set_value(cdt, cdn, 'package_qty', frm.doc.dn_package_qty || 0);
        frappe.model.set_value(cdt, cdn, 'entry_no', frm.doc.entry_no || '');

        // recompute totals
        compute_totals(frm);
    },

    // when a row is removed
    items_remove(frm, cdt, cdn) {
        compute_totals(frm);
    },

    // when package_qty changes -> recalc row weights
    package_qty(frm, cdt, cdn) {
        calculate_row_weights(frm, cdt, cdn);
    },

    // when unit_weight changes -> recalc row weights
    unit_weight(frm, cdt, cdn) {
        calculate_row_weights(frm, cdt, cdn);
    },

    // when user changes batch_reference in a row -> fetch batch details and update row+parent
    batch_reference(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.batch_reference) return;
        frappe.call({
            method: 'warehousing.warehousing.doctype.cargo_stock_receipt.cargo_stock_receipt.get_batch_details',
            args: { batch: row.batch_reference },
            callback: function (r) {
                if (!r || !r.message) return;
                const bt = r.message;
                // auto-fill fields
                frappe.model.set_value(cdt, cdn, 'item', bt.item);
                frappe.model.set_value(cdt, cdn, 'package_type', bt.stock_uom);
                frappe.model.set_value(cdt, cdn, 'warehouse', bt.t_warehouse);
                // recompute totals
                compute_totals(frm);
            }
        });
    },

    // when item selected in row -> fetch package type and unit weight
    item(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.item) return;
        frappe.call({
            method: 'warehousing.warehousing.doctype.cargo_stock_receipt.cargo_stock_receipt.get_item',
            args: { item: row.item },
            callback: function (r) {
                if (!r || !r.message) return;
                // server returns [stock_uom, weight] in your implementation
                const stock_uom = r.message[0];
                const weight = r.message[1];
                frappe.model.set_value(cdt, cdn, 'package_type', stock_uom);
                frappe.model.set_value(cdt, cdn, 'unit_weight', weight || 0);
                calculate_row_weights(frm, cdt, cdn);
            }
        });
    }
});

// ---------------------------
// Reusable: calculate_row_weights
// ---------------------------
function calculate_row_weights(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    let weight = 0;

    if (row.package_qty && row.unit_weight) {
        weight = flt(row.package_qty) * flt(row.unit_weight);
    }

    frappe.model.set_value(cdt, cdn, 'gross_weight', weight);
    frappe.model.set_value(cdt, cdn, 'net_weight', weight);

    // update parent totals
    compute_totals(frm);
}

// ---------------------------
// Basic client-side validation
// ---------------------------
function basic_client_validation(frm) {
    // ensure required fields on parent
    const required_parent = ['customer', 'source', 'arrival_date', 'receive_date', 'set_warehouse', 'set_package_type'];
    for (let f of required_parent) {
        if (!frm.doc[f]) {
            frappe.msgprint({
                title: __('Validation'),
                indicator: 'red',
                message: __('{0} is required.', [__(frm.meta.get_field(f).label)])
            });
            return false;
        }
    }

    // ensure no negative qty or weights in child table
    for (let r of (frm.doc.items || [])) {
        if (r.package_qty < 0) {
            frappe.msgprint({ title: __('Validation'), indicator: 'red', message: __('Package qty cannot be negative.') });
            return false;
        }
        if (r.unit_weight < 0) {
            frappe.msgprint({ title: __('Validation'), indicator: 'red', message: __('Unit weight cannot be negative.') });
            return false;
        }
    }

    return true;
}

