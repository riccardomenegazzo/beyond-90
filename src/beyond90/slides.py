"""A small PowerPoint writer: enough Office Open XML for text, shapes and speaker-free slides, with the standard library.

The engine runs in the browser with no third-party packages, so the executive review is written as a .pptx directly:
one master, one blank layout, a theme, and slides made of positioned text boxes and rectangles. Every text run is
escaped; the package is reproducible (fixed timestamps, fixed order).
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional
from xml.sax.saxutils import escape

EMU = 914400                                           # per inch
W, H = 12192000, 6858000                               # 13.333 x 7.5 in, 16:9
FONT = "Calibri"
NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT_PML = "application/vnd.openxmlformats-officedocument.presentationml"


_BAD_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")


def clean(text: str) -> str:
    """Escaped for XML, without the control characters XML cannot hold at all."""
    return escape(_BAD_XML.sub("", text), {'"': "&quot;"})


def inch(v: float) -> int:
    return round(v * EMU)


@dataclass
class Run:
    text: str
    size: float = 16
    bold: bool = False
    color: str = "1B2430"


@dataclass
class Slide:
    shapes: list[str] = field(default_factory=list)
    name: str = ""

    def _id(self) -> int:
        return len(self.shapes) + 2

    def rect(self, x: float, y: float, w: float, h: float, fill: str, line: Optional[str] = None, radius: bool = False) -> None:
        geom = "roundRect" if radius else "rect"
        ln = f'<a:ln w="9525"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>' if line else '<a:ln><a:noFill/></a:ln>'
        adj = '<a:avLst><a:gd name="adj" fmla="val 8000"/></a:avLst>' if radius else "<a:avLst/>"
        self.shapes.append(
            f'<p:sp><p:nvSpPr><p:cNvPr id="{self._id()}" name="Shape {self._id()}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{inch(x)}" y="{inch(y)}"/><a:ext cx="{max(inch(w), 1)}" cy="{max(inch(h), 1)}"/></a:xfrm>'
            f'<a:prstGeom prst="{geom}">{adj}</a:prstGeom><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>{ln}</p:spPr></p:sp>')

    def text(self, x: float, y: float, w: float, h: float, paragraphs: list[list[Run]], *, bullets: bool = False,
             align: str = "l", anchor: str = "t", space_after: float = 6) -> None:
        """Paragraphs of runs in a text box. With `bullets`, each paragraph is a bulleted item."""
        paras = []
        for runs in paragraphs:
            ppr = (f'<a:pPr marL="285750" indent="-285750" algn="{align}"><a:spcAft><a:spcPts val="{int(space_after * 100)}"/></a:spcAft>'
                   '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>' if bullets else
                   f'<a:pPr algn="{align}"><a:spcAft><a:spcPts val="{int(space_after * 100)}"/></a:spcAft><a:buNone/></a:pPr>')
            rs = ""
            for r in runs:
                props = (f'<a:rPr lang="en-US" sz="{int(r.size * 100)}" b="{1 if r.bold else 0}" dirty="0">'
                         f'<a:solidFill><a:srgbClr val="{r.color}"/></a:solidFill><a:latin typeface="{FONT}"/></a:rPr>')
                rs += f"<a:br>{props}</a:br>".join(f"<a:r>{props}<a:t>{clean(line)}</a:t></a:r>" for line in r.text.split("\n"))
            paras.append(f"<a:p>{ppr}{rs}</a:p>")
        self.shapes.append(
            f'<p:sp><p:nvSpPr><p:cNvPr id="{self._id()}" name="Text {self._id()}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{inch(x)}" y="{inch(y)}"/><a:ext cx="{inch(w)}" cy="{inch(h)}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
            f'<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="{anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>'
            f'{"".join(paras) or "<a:p/>"}</p:txBody></p:sp>')

    def xml(self) -> str:
        return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld {NS}><p:cSld name="{clean(self.name)}"><p:spTree>'
                '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
                '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
                f'{"".join(self.shapes)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')


THEME = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Beyond 90">'
         '<a:themeElements><a:clrScheme name="Beyond 90">'
         '<a:dk1><a:srgbClr val="1B2430"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="2A3542"/></a:dk2><a:lt2><a:srgbClr val="F3F5F9"/></a:lt2>'
         '<a:accent1><a:srgbClr val="2E46C8"/></a:accent1><a:accent2><a:srgbClr val="1E7F4F"/></a:accent2><a:accent3><a:srgbClr val="B4232A"/></a:accent3>'
         '<a:accent4><a:srgbClr val="A15C00"/></a:accent4><a:accent5><a:srgbClr val="5B6573"/></a:accent5><a:accent6><a:srgbClr val="7A4BC2"/></a:accent6>'
         '<a:hlink><a:srgbClr val="2E46C8"/></a:hlink><a:folHlink><a:srgbClr val="5B3FA8"/></a:folHlink></a:clrScheme>'
         f'<a:fontScheme name="Beyond 90"><a:majorFont><a:latin typeface="{FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
         f'<a:minorFont><a:latin typeface="{FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
         '<a:fmtScheme name="Beyond 90"><a:fillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' * 3 + '</a:fillStyleLst>'
         '<a:lnStyleLst>' + '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' * 3 + '</a:lnStyleLst>'
         '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>' * 3 + '</a:effectStyleLst>'
         '<a:bgFillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' * 3 + '</a:bgFillStyleLst></a:fmtScheme>'
         '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>')

MASTER = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster {NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>'
          '<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
          '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>'
          '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" '
          'accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
          '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>'
          '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>')

LAYOUT = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout {NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>'
          '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
          '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>'
          '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')


def _rels(items: list[tuple[str, str, str]]) -> str:
    body = "".join(f'<Relationship Id="{i}" Type="{t}" Target="{escape(tg)}"/>' for i, t, tg in items)
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'


def package(slides: list[Slide], title: str) -> bytes:
    """The .pptx bytes for these slides."""
    n = len(slides)
    parts: dict[str, str] = {}
    over = "".join(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="{CT_PML}.slide+xml"/>' for i in range(1, n + 1))
    parts["[Content_Types].xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        f'<Override PartName="/ppt/presentation.xml" ContentType="{CT_PML}.presentation.main+xml"/>'
        f'<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="{CT_PML}.slideMaster+xml"/>'
        f'<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="{CT_PML}.slideLayout+xml"/>'
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
        f'<Override PartName="/ppt/presProps.xml" ContentType="{CT_PML}.presProps+xml"/>'
        f'<Override PartName="/ppt/viewProps.xml" ContentType="{CT_PML}.viewProps+xml"/>'
        f'<Override PartName="/ppt/tableStyles.xml" ContentType="{CT_PML}.tableStyles+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        f'{over}</Types>')
    parts["_rels/.rels"] = _rels([("rId1", f"{REL}/officeDocument", "ppt/presentation.xml"),
                                  ("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
                                  ("rId3", f"{REL}/extended-properties", "docProps/app.xml")])
    parts["docProps/core.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<dc:title>{clean(title)}</dc:title><dc:creator>Beyond 90</dc:creator></cp:coreProperties>")
    parts["docProps/app.xml"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
                                 f"<Application>Beyond 90</Application><Slides>{n}</Slides></Properties>")
    ids = "".join(f'<p:sldId id="{256 + i}" r:id="rId{i + 2}"/>' for i in range(n))
    parts["ppt/presentation.xml"] = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation {NS} saveSubsetFonts="1">'
        f'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{ids}</p:sldIdLst>'
        f'<p:sldSz cx="{W}" cy="{H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>')
    parts["ppt/_rels/presentation.xml.rels"] = _rels(
        [("rId1", f"{REL}/slideMaster", "slideMasters/slideMaster1.xml")] + [(f"rId{i + 2}", f"{REL}/slide", f"slides/slide{i + 1}.xml") for i in range(n)]
        + [(f"rId{n + 2}", f"{REL}/presProps", "presProps.xml"), (f"rId{n + 3}", f"{REL}/viewProps", "viewProps.xml"),
           (f"rId{n + 4}", f"{REL}/theme", "theme/theme1.xml"), (f"rId{n + 5}", f"{REL}/tableStyles", "tableStyles.xml")])
    parts["ppt/presProps.xml"] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr {NS}/>'
    parts["ppt/viewProps.xml"] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr {NS}/>'
    parts["ppt/tableStyles.xml"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                                    'def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>')
    parts["ppt/theme/theme1.xml"] = THEME
    parts["ppt/slideMasters/slideMaster1.xml"] = MASTER
    parts["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = _rels([("rId1", f"{REL}/slideLayout", "../slideLayouts/slideLayout1.xml"),
                                                                   ("rId2", f"{REL}/theme", "../theme/theme1.xml")])
    parts["ppt/slideLayouts/slideLayout1.xml"] = LAYOUT
    parts["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = _rels([("rId1", f"{REL}/slideMaster", "../slideMasters/slideMaster1.xml")])
    for i, s in enumerate(slides, 1):
        parts[f"ppt/slides/slide{i}.xml"] = s.xml()
        parts[f"ppt/slides/_rels/slide{i}.xml.rels"] = _rels([("rId1", f"{REL}/slideLayout", "../slideLayouts/slideLayout1.xml")])
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ["[Content_Types].xml", *sorted(k for k in parts if k != "[Content_Types].xml")]:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, parts[name].encode("utf-8"))
    return buf.getvalue()
