"""Audit a Roblox XML model file (rbxmx).

Opens temp.rbxmx, locates the deepest nested <Item> tag, injects two new
<Item> children (NumberPose and Script), and writes the result to output.rbxmx.
"""

import xml.etree.ElementTree as ET


INPUT_FILE = "temp.rbxmx"
OUTPUT_FILE = "output.rbxmx"


def find_deepest_item(root):
    """Return the deepest nested <Item> element and its depth."""
    best = None
    best_depth = -1

    def _walk(element, depth):
        nonlocal best, best_depth
        if element.tag == "Item":
            if depth > best_depth:
                best = element
                best_depth = depth
        for child in element:
            _walk(child, depth + 1)

    _walk(root, 0)
    return best


def _make_property(tag, name, value):
    """Create a <Properties> sub-element like <string name="Name">value</string>."""
    prop = ET.SubElement(ET.Element("_"), tag)
    prop.set("name", name)
    prop.text = str(value)
    return prop


def build_item(class_name, properties):
    """Build an <Item class="..."> element with a <Properties> block.

    ``properties`` is a list of (xml_tag, name_attr, text_value) tuples.
    """
    item = ET.Element("Item")
    item.set("class", class_name)
    props = ET.SubElement(item, "Properties")
    for xml_tag, name_attr, text_value in properties:
        elem = ET.SubElement(props, xml_tag)
        elem.set("name", name_attr)
        elem.text = str(text_value)
    return item


def main():
    tree = ET.parse(INPUT_FILE)
    root = tree.getroot()

    deepest = find_deepest_item(root)
    if deepest is None:
        raise SystemExit("No <Item> tags found in " + INPUT_FILE)

    number_pose = build_item("NumberPose", [
        ("string", "Name", "ConfigPose"),
        ("int64", "Value", "93161583751848"),
    ])

    script = build_item("Script", [
        ("string", "Name", "SyncNode"),
        ("ProtectedString", "Source", "print(1)"),
    ])

    deepest.append(number_pose)
    deepest.append(script)

    ET.indent(tree, space="  ")
    tree.write(OUTPUT_FILE, xml_declaration=True, encoding="unicode")
    print(f"Written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
