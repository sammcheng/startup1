from dataclasses import dataclass
from typing import Any

from app.models.tool import InputType, OutputType, Tool


@dataclass
class DemoInputComponent:
    type: str
    name: str
    label: str
    required: bool = False
    placeholder: str | None = None
    accept: str | None = None


@dataclass
class DemoConfig:
    input_components: list[DemoInputComponent]
    output_component: str
    example_input: Any = None


def generate_demo_config(tool: Tool) -> DemoConfig:
    input_schema = tool.input_schema or {}
    fields = input_schema.get("fields")

    if isinstance(fields, list) and fields:
        input_components = [
            _component_from_field(field) for field in fields if isinstance(field, dict)
        ]
    else:
        input_components = [_default_component_for_input_type(tool.input_type, input_schema)]

    output_component = _output_component_for_type(tool.output_type)
    example_input = (
        input_schema.get("example")
        or input_schema.get("example_input")
        or tool.output_schema.get("example_input")
        if tool.output_schema
        else None
    )

    return DemoConfig(
        input_components=input_components,
        output_component=output_component,
        example_input=example_input,
    )


def _component_from_field(field: dict[str, Any]) -> DemoInputComponent:
    field_type = str(field.get("type", "string")).lower()
    label = str(field.get("label") or field.get("name") or "Field")
    name = str(field.get("name") or label.lower().replace(" ", "_"))

    if field_type == "number":
        return DemoInputComponent(
            type="text", name=name, label=label, required=bool(field.get("required"))
        )
    if field_type == "file":
        return DemoInputComponent(
            type="file", name=name, label=label, required=bool(field.get("required"))
        )
    if field_type == "url":
        return DemoInputComponent(
            type="url", name=name, label=label, required=bool(field.get("required"))
        )

    return DemoInputComponent(
        type="text",
        name=name,
        label=label,
        required=bool(field.get("required")),
        placeholder=field.get("placeholder"),
    )


def _default_component_for_input_type(
    input_type: InputType | None, input_schema: dict[str, Any]
) -> DemoInputComponent:
    placeholder = input_schema.get("placeholder")

    if input_type == InputType.image:
        return DemoInputComponent(
            type="image", name="input", label="Image", required=True, accept="image/*"
        )
    if input_type == InputType.json:
        return DemoInputComponent(
            type="json", name="input", label="JSON", required=True, placeholder=placeholder
        )
    if input_type == InputType.csv:
        return DemoInputComponent(
            type="file", name="input", label="CSV file", required=True, accept=".csv,text/csv"
        )
    if input_type == InputType.url:
        return DemoInputComponent(
            type="url",
            name="input",
            label="URL",
            required=True,
            placeholder=placeholder or "https://example.com",
        )
    if input_type == InputType.file:
        return DemoInputComponent(type="file", name="input", label="File", required=True)

    return DemoInputComponent(
        type="text",
        name="input",
        label="Text",
        required=True,
        placeholder=placeholder or "Enter your input",
    )


def _output_component_for_type(output_type: OutputType | None) -> str:
    if output_type == OutputType.text:
        return "text"
    if output_type == OutputType.image:
        return "image"
    if output_type == OutputType.csv:
        return "table"
    if output_type == OutputType.file:
        return "file"
    return "json"
