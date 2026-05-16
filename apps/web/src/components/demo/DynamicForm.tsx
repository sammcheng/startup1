"use client";

import FileInput from "./FileInput";
import ImageArrayInput from "./ImageArrayInput";
import NumberInput from "./NumberInput";
import TextInput from "./TextInput";
import URLInput from "./URLInput";
import type { DemoFileValue, DemoImageValue, DemoInputSchema, DemoSchemaField } from "./types";

type DynamicValue = Record<string, string | number | boolean | null | DemoFileValue | DemoImageValue[]>;
type DynamicFieldValue = DynamicValue[string];

interface DynamicFormProps {
  schema: DemoInputSchema;
  value: DynamicValue;
  onChange: (value: DynamicValue) => void;
  disabled?: boolean;
  errors?: Record<string, string | null>;
}

export default function DynamicForm({ schema, value, onChange, disabled, errors = {} }: DynamicFormProps) {
  const fields = schema.fields ?? [];

  if (!fields.length) {
    return (
      <div className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-sm text-stone-500">
        No schema-driven fields were provided for this tool.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {fields.map((field) => (
        <FieldRenderer
          key={field.name}
          field={field}
          value={value[field.name] ?? (field.type === "number" ? "" : field.type === "file" ? null : "")}
          disabled={disabled}
          error={errors[field.name] ?? null}
          onChange={(next) => onChange({ ...value, [field.name]: next })}
        />
      ))}
    </div>
  );
}

function FieldRenderer(props: {
  field: DemoSchemaField;
  value: DynamicFieldValue;
  disabled?: boolean;
  error: string | null;
  onChange: (value: DynamicFieldValue) => void;
}) {
  const label = props.field.label || humanize(props.field.name);

  if (props.field.type === "url") {
    return (
      <URLInput
        label={label}
        value={String(props.value ?? "")}
        onChange={(next) => props.onChange(next)}
        disabled={props.disabled}
        error={props.error}
        placeholder={props.field.placeholder}
      />
    );
  }

  if (props.field.type === "file") {
    if (props.field.name === "images") {
      return (
        <ImageArrayInput
          label={label}
          value={(props.value as DemoImageValue[] | null) ?? []}
          onChange={(next) => props.onChange(next)}
          disabled={props.disabled}
          error={props.error}
        />
      );
    }

    return (
      <FileInput
        label={label}
        value={(props.value as DemoFileValue | null) ?? null}
        onChange={(next) => props.onChange(next)}
        disabled={props.disabled}
        error={props.error}
      />
    );
  }

  if (props.field.type === "number") {
    return (
      <NumberInput
        label={label}
        value={String(props.value ?? "")}
        onChange={(next) => props.onChange(next)}
        disabled={props.disabled}
        error={props.error}
        placeholder={props.field.placeholder}
      />
    );
  }

  return (
    <TextInput
      label={label}
      value={String(props.value ?? "")}
      onChange={(next) => props.onChange(next)}
      disabled={props.disabled}
      error={props.error}
      placeholder={props.field.placeholder}
    />
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
