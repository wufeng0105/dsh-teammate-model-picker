/**
 * L0 adapter — the only place that touches schemastery.
 *
 * `volatile()` marks the fields the settings Remote may edit live
 * (`volatileForm`/`isVolatilePath` skip non-volatile fields, so without the
 * marker the client picker could neither read nor write this namespace — see
 * DESIGN.md "why the config layer is the only seam").
 */
import Schema from '../../vendor/schemastery.mjs';

export const Config = Schema.object({
    /** Show the picker for teammate sessions (client-side switch). */
    showPicker: Schema.boolean().default(true).volatile(),
    /**
     * Durable per-teammate model overrides, keyed by the teammate's own session
     * id. Written through `settings.mutate` by the picker; replaced wholesale on
     * each pick. `reasoningEffort` may be empty to let the model resolve its
     * provider default.
     */
    overrides: Schema.array(Schema.object({
        childSessionId: Schema.string().required(),
        provider: Schema.string().required(),
        model: Schema.string().required(),
        reasoningEffort: Schema.string(),
    })).default([]).volatile(),
});

/**
 * A `volatile()` field validates into an accessor object (`{ get() }`), not a
 * plain value. Both shapes are accepted so that a schema-protocol change
 * degrades to "read the raw value" instead of "read nothing, silently".
 */
export function readVolatileValue(field, fallback) {
    if (field === undefined || field === null) return fallback;
    if (typeof field === 'object' && typeof field.get === 'function') {
        const value = field.get();
        return value === undefined ? fallback : value;
    }
    return field;
}

export function readOverrides(config) {
    return readVolatileValue(config?.overrides, []);
}

/** Absent/false means "do not render"; anything else leaves the picker on. */
export function readShowPicker(config) {
    const value = readVolatileValue(config?.showPicker, true);
    return value !== false;
}
