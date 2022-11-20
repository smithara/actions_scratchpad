importScripts("https://cdn.jsdelivr.net/pyodide/v0.21.3/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.1/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.1/dist/wheels/panel-0.14.1-py3-none-any.whl', 'pyodide-http==0.1.0', 'pandas', 'markdown', 'tabulate']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

#!/usr/bin/env python
# coding: utf-8

# # Tool for creating/editing Swarm product metadata

# ## Preamble

# In[ ]:


from copy import deepcopy
import csv
from dataclasses import dataclass, field
from io import StringIO, BytesIO
import json
import os
from tempfile import NamedTemporaryFile
from textwrap import dedent

from markdown import markdown
import pandas as pd
import panel as pn
from tabulate import tabulate

pn.extension('ace', 'jsoneditor', 'texteditor', 'quill', 'tabulator')


# In[ ]:


# Identify directory of this file
try:
    # when running in notebook
    _here = globals()['_dh'][0]
except KeyError:
    # when running in regular interpreter
    _here = os.path.dirname(__file__)

# CSV_PATH = os.path.join(_here, "input/overview.csv")
# CSV_VARTABLES_PATH = os.path.join(_here, "input/vartables")
JSON_FILES_PATH = os.path.join(_here, "catalog")


# ## Define product metadata and catalog structure

# In[ ]:


# Beginning of schema to run validation
# See http://json-schema.org/ to extend
SCHEMA = {
  "title": "Product",
  "type": "object",
  "properties": {
    "product_id": {
      "type": "string",
    },
    "name": {
      "type": "string",
    },
    "description": {
      "type": "string",
    },
    "variables": {
      "type": "string",
    }, 
  }
}


# In[ ]:


@dataclass
class Product:
    product_id: str = ""
    name: str = ""
    thematic_areas: "list[str]|None" = field(default_factory=lambda: [])
    description: str = ""
    link_files_http: str = ""
    link_files_ftp: str = ""
    link_vires_gui: str = ""
    link_notebook: str = ""
    link_hapi: str = ""
    variables_table: str = ""
    related_resources: "list[str]|None" = field(default_factory=lambda: [])
    details: str = ""
    
    @staticmethod
    def allowed_thematic_areas():
        return [
            'Magnetic measurements',
            'Plasma measurements',
            'Space Weather',
            'Ionosphere/Magnetosphere',
            'Thermosphere',
            'Lithosphere',
            'Core field',
            'Ocean Tides',
            'Mantle',
            'Geodesy/Gravity',
            'Acceleration measurements',
            'Attitude information',
            'Orbit information',
            'Ephemeris',
            'GNSS measurements',
            'HK data',
        ]
    
    def __str__(self):
        items = self.as_dict()
        items = [f"{k}:\\n{v}" for k, v in items.items()]
        return "\\n\\n".join(items)

    def as_dict(self):
        items = {}
        for field in self.__dataclass_fields__:
            value = getattr(self, field)
            items[field] = value
        return items
    
    def as_json(self):
        return json.dumps(self.as_dict())

    def get_json_file(self):
        tempfile = NamedTemporaryFile()
        tempfile.write(bytes(self.as_json(), "utf-8"))
        tempfile.seek(0)
        return tempfile

    @property
    def tabulate_variables(self):
        if self.variables_table == "":
            return ""
        try:
            df = pd.read_csv(StringIO(self.variables_table))
            return tabulate(df.values, df.columns, tablefmt="pipe")
        except Exception:
            return "INVALID TABLE"

    @property
    def markdown_links(self):
        s = ""
        if any((self.link_files_http, self.link_files_ftp)):
            s += "- Files:\\n"
            if self.link_files_http:
                s += f"\t- <{self.link_files_http}>\\n"
            if self.link_files_ftp:
                s += f"\t- {self.link_files_ftp}\\n"
        if any((self.link_vires_gui, self.link_notebook, self.link_hapi)):
            s += "- Web services:\\n"
            if self.link_vires_gui:
                s += f"\t- [VirES GUI]({self.link_vires_gui})\\n"
            if self.link_notebook:
                s += f"\t- [Notebook]({self.link_notebook})\\n"
            if self.link_hapi:
                s += f"\t- [HAPI]({self.link_hapi})\\n"
        s = s.rstrip()
        return s
    
    @property
    def markdown_preview(self):
        items = [
            f"# {self.product_id}\\n\\n{self.name}\\n\\nThematic areas: {','.join(self.thematic_areas)}",
            f"## Description\\n\\n{self.description}",
            f"## Data access\\n\\n{self.markdown_links}",
            f"## File contents\\n\\n{self.tabulate_variables}",
            f"## More details\\n\\n{self.details}",
        ]
        return "\\n\\n".join(items)
    
    @property
    def html_preview(self):
        return markdown(self.markdown_preview)
    
    @classmethod
    def from_json(cls, bytestring):
        product_json = json.loads(bytestring)
        difference = set(product_json.keys()) - set(cls.__dataclass_fields__)
        if difference:
            raise TypeError(f"Mismatching product fields in supplied .json:\\n{difference}")
        return cls(**product_json)
    
    @classmethod
    def from_json_file(cls, path):
        with open(path, "r") as f:
            product_json = json.load(f)
        difference = set(product_json.keys()) - set(cls.__dataclass_fields__)
        if difference:
            raise TypeError(f"Mismatching product fields in supplied .json:\\n{difference}")
        return cls(**product_json)


# In[ ]:


# product = Product(
#     product_id="MAGx_LR_1B",
#     name="Magnetic field (1Hz) from VFM and ASM",
#     description="The MAGX_LR_1B Product contains magnetic vector and scalar data at 1 Hz rate. The S/C data are processed to provide MAGX_LR_1B data at exact UTC seconds, i.e. both VFM vector and ASM scalar data are interpolated to yield these data. Hence, small gaps in the VFM or ASM data need not cause gaps in the product as the gaps may be filled by this interpolation. Any gaps, however, will have an impact on the error estimate of the associated product element.",
# )

# print(product.markdown_preview)


# In[ ]:


@dataclass
class Catalog:
    products: "dict[Product]"
    
    @property
    def product_ids(self):
        return list(self.products.keys())
    
    def get_product(self, product_id):
        return self.products.get(product_id)


# In[ ]:


# c = Catalog(products={product.product_id: product})
# c.product_ids


# ## Load catalog from existing files

# In[ ]:


# def load_data_old():
#     overview = pd.read_csv(CSV_PATH, index_col="Name")
#     details = {}
#     for name in overview.index:
#         fpath = os.path.join(CSV_VARTABLES_PATH, name + ".csv")
#         try:
#             vartable = pd.read_csv(fpath, index_col="Variable")
#         except Exception:
#             vartable = None
#         details[name] = vartable
#     return overview, details

# def create_catalog_old():
#     overview, var_tables = load_data_old()
#     products = {}
#     for product_id in overview.index:
#         row = overview.loc[product_id]
#         var_table = var_tables[product_id]
#         var_table = var_table.to_csv() if var_table is not None else ""
#         thematic_areas = []
#         if row["Thematic area 1"]:
#             thematic_areas.append(row["Thematic area 1"])
#         if row["Thematic area 2"]:
#             thematic_areas.append(row["Thematic area 2"])
#         link_files_http = row["Link: HTTP"]
#         if link_files_http != "-":
#             link_files_http = link_files_http.replace("%2F", "/")
#             link_files_ftp = link_files_http.replace("#swarm/", "").replace("https", "ftp")
#         else:
#             link_files_http = ""
#             link_files_ftp = ""
#         product = Product(
#             product_id=product_id,
#             name=row["Short description"],
#             thematic_areas=thematic_areas,
#             description=row["Long description"],
#             link_files_http=link_files_http,
#             link_files_ftp=link_files_ftp,
#             variables_table=var_table,
#         )
#         products[product_id] = product
#     return Catalog(products=products)
#
# CATALOG_OLD = create_catalog_old()
#
# def transfer_old_catalog():
#     for product_id in CATALOG_OLD.product_ids:
#         p = CATALOG_OLD.get_product(product_id)
#         p.product_id = f"SW-{product_id}"
#         with open(f"json/SW-{product_id}.json", "w") as f:
#             f.write(p.as_json())
#
# transfer_old_catalog()
# (then some manual fixing)


# In[ ]:


# # Fix incorrect thematic_areas

# p = CATALOG.get_product("SW-MAGx_LR_1B")
# for id in CATALOG.product_ids:
#     p = CATALOG.get_product(id)
#     for i in [0, 1]:
#         p.thematic_areas[i] = p.thematic_areas[i].strip()
#     p.thematic_areas = [i for i in p.thematic_areas if i in Product.allowed_thematic_areas()]
#     with open(f"catalog-2/{p.product_id}.json", "w") as f:
#         f.write(p.as_json())


# In[ ]:


def load_catalog():
    paths = os.listdir(JSON_FILES_PATH)
    paths = [os.path.join(JSON_FILES_PATH, p) for p in paths if ".json" in p]
    products = []
    for path in paths:
        products.append(Product.from_json_file(path))
    products = {p.product_id: p for p in products}
    return Catalog(products=products)

CATALOG = load_catalog()


# ## Dashboard

# In[ ]:


class ProductMetadataDashboard:
    def __init__(self):
        # Internal product state, initialise empty
        self.product = Product()
        # Widgets to alter product state (call .refresh to trigger the update from these)
        # names (dict keys) must match properties of Product
        self.widgets = dict(
            product_id = pn.widgets.TextInput(name="product_id:", value=self.product.product_id),
            name = pn.widgets.TextInput(name="name:", value=self.product.name),
            description = pn.widgets.TextEditor(
                name="description:", value=self.product.description,
                toolbar=[["bold", "italic", "code"], ["link"], [{ 'list': 'ordered'}, { 'list': 'bullet' }]],
                height=300, background="white"
            ),
            thematic_areas = pn.widgets.MultiChoice(name='Thematic areas:', options=Product.allowed_thematic_areas(), background="white"),
            link_files_http = pn.widgets.TextInput(placeholder='link_files_http'),
            link_files_ftp = pn.widgets.TextInput(placeholder='link_files_ftp'),
            link_vires_gui = pn.widgets.TextInput(placeholder='link_vires_gui'),
            link_notebook = pn.widgets.TextInput(placeholder='link_notebook'),
            link_hapi = pn.widgets.TextInput(placeholder='link_hapi'),
            variables_table = pn.widgets.TextAreaInput(name="variables_table (csv):", value=self.product.variables_table, height=200),
            details = pn.widgets.TextEditor(
                name="details:", value=self.product.details,
                toolbar=[["bold", "italic", "code"], ["link"], [{ 'list': 'ordered'}, { 'list': 'bullet' }], ["image"]],
                height=400, background="white"
            ),
        )
        # Widgets to control dashboard
        self.widgets_extra = dict(
            product_id_selector=pn.widgets.AutocompleteInput(options=CATALOG.product_ids, placeholder="Start typing SW-MAG...", width=200),
            refresh_editor_button=pn.widgets.Button(name="Load", width=50, button_type="primary"),
            refresh_view_button=pn.widgets.Button(name="Refresh!", width=50, button_type="primary"),
            external_file_loader=pn.widgets.FileInput(),
            refresh_editor_button_from_file=pn.widgets.Button(name="Load", width=50, button_type="primary"),
        )
        self.widgets_extra["refresh_editor_button"].on_click(self.refresh_from_local)
        self.widgets_extra["refresh_view_button"].on_click(self.refresh_output)
        self.widgets_extra["refresh_editor_button_from_file"].on_click(self.refresh_from_external_file)
        # Tools to show the output view of the product
        self.json_viewer = pn.widgets.JSONEditor(
            value=self.product.as_dict(), schema=SCHEMA,
            mode="view", sizing_mode="stretch_both", max_height=1000
        )
        self.json_file = self.product.get_json_file()
        self.json_downloader = pn.widgets.FileDownload(
            file=self.json_file.name,
            filename=f"{self.product.product_id}.json",
        )
        self.markdown_viewer = pn.pane.Markdown(self.product.markdown_preview, background="white", sizing_mode="stretch_both", max_height=1000)
#         self.html_viewer = pn.pane.HTML(self.product.html_preview)
    
    def refresh_output(self, event):
        for k in self.widgets.keys():
            setattr(self.product, k, self.widgets[k].value)
        self.json_file = self.product.get_json_file()
        self.json_downloader.file = self.json_file.name
        self.json_downloader.filename = f"{self.product.product_id}.json"
        self.json_viewer.value = self.product.as_dict()
        self.markdown_viewer.object = self.product.markdown_preview
#         self.html_viewer.object = self.product.html_preview
    
    def refresh_from_local(self, event):
        product_id = self.widgets_extra["product_id_selector"].value
        if product_id in CATALOG.product_ids:
            self.update_product(CATALOG.get_product(product_id))
    
    def refresh_from_external_file(self, event):
        self.update_product(
            Product.from_json(self.widgets_extra["external_file_loader"].value)
        )
    
    def update_product(self, product):
        self.product = deepcopy(product)
        for k in self.widgets.keys():
            self.widgets[k].value = getattr(self.product, k)
        self.refresh_output(None)    

    @property
    def loader(self):
        return pn.Row(
            pn.Column(
                "**Load from existing records**",
                pn.Row(
                    self.widgets_extra["product_id_selector"],
                    self.widgets_extra["refresh_editor_button"],
                ),
                background="orange",
                margin=10
            ),
            pn.Column(
                "**Load from local file**",
                pn.Row(
                    self.widgets_extra["external_file_loader"],
                    self.widgets_extra["refresh_editor_button_from_file"],
                ),
                background="orange",
                margin=10
            ),
            
        )
                
        
    @property
    def editor(self):
        return pn.Column(
            "**Edit properties**",
            self.widgets["product_id"],
            self.widgets["name"],
            self.widgets["thematic_areas"],
            "Links:",
            self.widgets["link_files_http"],
            self.widgets["link_files_ftp"],
            self.widgets["link_vires_gui"],
            self.widgets["link_notebook"],
            self.widgets["link_hapi"],
            "description:",
            self.widgets["description"],
            self.widgets["variables_table"],
            "details:",
            self.widgets["details"],
            background="lightblue",
            sizing_mode="stretch_both"
        )

    @property
    def viewer(self):
        return pn.Column(
            "**Check display preview and download output json**",
            self.widgets_extra["refresh_view_button"],
            self.json_downloader,
            pn.Tabs(
                ("JSON", self.json_viewer),
#                 ("Output preview", self.html_viewer)
                ("Output preview", self.markdown_viewer),
                sizing_mode="stretch_both",
            ),
            background="lightgreen",
            sizing_mode="stretch_both",
        )

    @property
    def complete(self):
        gspec = pn.GridSpec(sizing_mode="stretch_both", )#min_height=3000)
        gspec[:, 0] = pn.Column(
            self.loader,
            self.editor,
            margin=10
        )
        gspec[:, 1] = self.viewer
        return gspec


# In[ ]:


dashboard = ProductMetadataDashboard()


# In[ ]:


# run this twice to fix it (??)
dashboard.complete.servable()



await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()