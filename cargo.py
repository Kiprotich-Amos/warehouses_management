# Copyright (c) 2022, Stelden EA Ltd and contributors
# For license information, please see license.txt
# Re-Edit done by Amoroki Limited Developers
import frappe 
from frappe.model.document import Document
from frappe.model.naming import make_autoname
from frappe.utils import nowdate, nowtime, flt 

class CargoStockReceipt(Document):
   def on_submit(self):
      """
	        Executed when the user clicks Submit. 
	        Orchestrates the creation of Stock, Batch, and Billing records.
      """
      # 1. Idempotency Check: Don't run if Stock Entry already exists
      if self.stock_entry_reference:
         return
      # 2. Handle Batch (Create New or Get Existing)
      batch_doc = self.handle_batch_creation()

      # 3. Create Serial and Batch Bundle (Required for Stock Entry v14+)
      sb_bundle_doc = self.create_serial_batch_bundle(batch_doc.name)
      
        # 4. Create and Submit Stock Entry
      self.create_stock_entry(batch_doc.name, sb_bundle_doc.name)

        # 5. Create Sales Order (Billing)
      self.create_billing_sales_oder()

        # 6. Final Save to update references created above
      self.save(ignore_permissions = True)



    
   def handle_batch_creation(self):
      """
      Determine if we need a new batch or use an existing one. 
            Return the Batch Document object
        """
      if self.status == "New":
         if not self.item:
            frappe.throw("Items is Required to create a New Batch.")

         batch = frappe.new_doc("Batch")

         # Naming Logic: GC-Customer-YY-MM-##
         client = self.customer # cust_name to mean client
         batch.batch_id = make_autoname('GC-'+ str(client) + '-.YY.-.MM.-.##.')


         batch.item = self.item
         batch.stock_uom = self.set_package_type
         batch.batch_qty = self.total_packages
         batch.customer = self.customer
         batch.current_owner = self.customer
         batch_date_of_transfer = self.receive_date
         batch.t_warehouse = self.set_warehouse
         batch.gross_weight = self.total_gross_weight
         batch.unit_wgt = self.dn_package_weight
         batch.cargo_stock_receipt_reference = self.name

         if self.entry_no:
            batch.entry_no = self.entry_no
         if self.bol_no:
            batch.boe_no = self.bol_no

         batch.insert(ignore_permissions =True)
         batch.submit()

         # update cargo stock receipt fields (assuming batch_name is defined elsewhere or should be batch.name)
         self.db_set('new_batch', batch.name)
         self.db_set('batch', batch.name)
         return batch
      elif self.status == 'Existing':
         if not self.batch:
            frappe.throw("please select an existing Batch/consignment.")
         return frappe.get_doc("Batch", self.batch)
      else:
         frappe.throw(f"Status must be 'New' or 'Existing' not {self.status}")

   def create_serial_batch_bundle(self,batch_name):
        """ Creates the Bundle required to move batch items. """
        sb_bundle = frappe.new_doc("Serial and Batch Bundle")
        sb_bundle.item_code = self.item
        sb_bundle.warehouse = self.set_warehouse
        sb_bundle.type_of_transaction = 'Inward'
        sb_bundle.company = frappe.defaults.get_user_default("Company")
        sb_bundle.voucher_type = 'Stock Entry'

        sb_bundle.append('entries', {
            'batch_no':batch_name,
            'qty': flt(self.total_packages),
            'warehouse': self.set_warehouse
        })

        sb_bundle.insert(ignore_permissions= True)
        sb_bundle.submit()

        self.db_set('serial_and_batch_bundle', sb_bundle.name)
        return sb_bundle

   def create_stock_entry(self, batch_name, sb_bundle_name):
        """
            Create the Material Receipt Stock Entry.
        """
        stock_entry = frappe.new_doc("Stock Entry")
        stock_entry.stock_entry_type = 'Material Receipt'
        stock_entry.purpose = 'Material Receipt'
        stock_entry.company = frappe.defaults.get_user_default("Company")
        stock_entry.posting_date = self.receive_date or nowdate()
        stock_entry.posting_time= nowtime()
        stock_entry.to_warehouse = self.set_warehouse
        stock_entry.apply_putaway_rule = 1

        if hasattr(stock_entry, 'custom_cargo_stock_receipt'):
            stock_entry.custom_cargo_stock_receipt = self.name


        for row in self.items:
            stock_entry.append('items',{
                'item_code': row.item_code or self.item,
                'qty': row.package_qty,
                'transfer_qty': row.package_qty,
                'uom': row.package_type,
                'stock_uom': row.package_type,
                't_warehouse': self.set_warehouse,
                'allow_zero_valuation_rate': 1,
                'serial_and_batch_bundle': sb_bundle_name,
                'batch_no': batch_name
                }

            )

        stock_entry.insert(ignore_permissions = True)
        stock_entry.submit()

        # update References
        self.db_set('stock_entry_reference', stock_entry.name)

        # Link Stock Entry back to batch

        frappe.db.set_value("Batch", batch_name, "stock_entry_reference", stock_entry.name)

        # update child table references
        for row  in self.items:
            row.db_set('stock_entry_reference', stock_entry.name)
            row.db_set('batch_reference', batch_name)

   def create_billing_sales_oder(self):
        """ 
            Generate Sales Order based on Warehouse Settings.
        """
        try:
            settings = frappe.get_doc('warehouse Settings')
        except frappe.DoesNotExistError:
            return	
        
        if not settings.auto_generate_sales_order:
            return

        # Default container billings Check
        bill_per_container = 0

        # Logic Bill by Weight (standard)

        if bill_per_container == 0:
            new_so = frappe.new_doc("Sales Order")
            new_so.customer = self.customer
            new_so.order_type = 'Sales'
            new_so.transaction_date = nowdate()
            new_so.delivery_date = nowdate()
            new_so.company = frappe.defaults.get_user_default("Company")

            if hasattr(new_so, 'custom_cargo_stock_receipt_reference'):
                new_so.custom_cargo_stock_receipt_reference = self.name

            if settings.general_cargo_handling_in_item:
                new_so.append('items',{
                    'item_code': settings.general_cargo_handling_in_item,
                    'delivery_date': nowdate(),
                    'description': f'{self.item} : {self.naming_series} ({self.total_gross_weight} {self.set_package_type})',
                    'uom': settings.general_cargo_handling_billing_uom,
                    'qty': flt(self.total_gross_weight) / 1000
                    }
                )
            if settings.general_cargo_handling_out_item:
                new_so.append('items',{
                    'item_code': settings.general_cargo_handling_out_item,
                    'delivery_date': nowdate(),
                    'description': f'Handling out for {self.item} : {self.naming_series}',
                    'uom': settings.general_cargo_handling_billing_uom,
                    'qty': flt(self.total_gross_weight) / 1000
                    }
                )
            if len(new_so.items) > 0:
                new_so.insert(ignore_permissions = True)
                new_so.submit()
                frappe.msgprint(f"Created Sales Order: {new_so.name}")
        # Logic 2 Bill By Container
        elif bill_per_container == 1 and self.container_details:
            cnt_40 = 0
            cnt_20 = 0

            for c in self.container_details:
                c_size = int(c.container_size) if c.container_size else 0
                if c_size == 40: cnt_40 +=1
                if c_size == 20: cnt_20 +=1
            if cnt_40 >0 or cnt_20 >0:
                new_so = frappe.new_doc("Sales Order")
                new_so.customer = self.customer
                new_so.order_type = 'Sales'
                new_so.company = frappe.defaults.get_user_default("Company")
                new_so.delivery_date = nowdate()

                if hasattr(new_so, 'custom_cargo_stock_receipt_reference'):
                    new_so.custom_cargo_stock_receipt_reference = self.name

                if cnt_40 > 0:
                    if settings.general_cargo_handling_in_item_40ft_container:
                        new_so.append('items', {'item_code': settings.general_cargo_handling_in_item_40ft_container, 'qty': cnt_40, 'delivery_date': nowdate()})
                    if settings.general_cargo_handling_out_item_40ft_container:
                        new_so.append('items', {'item_code': settings.general_cargo_handling_out_item_40ft_container, 'qty': cnt_40, 'delivery_date': nowdate()})
