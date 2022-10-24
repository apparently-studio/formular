import { Accessor, createMemo, onCleanup, onMount, batch } from "solid-js";
import { createStore, unwrap } from "solid-js/store";

// @ts-ignore
import stableHash from "stable-hash";

export type FieldValidator = (value: any, values: any) => Promise<string | void>

type FormElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface NamePathPart {
    value: string | number
    arrayIndex: boolean
}

type Field = {
    path: NamePathPart[]
    ref?: FormElement
    value: any
    touched: boolean
    errors: string[]
    validators: FieldValidator[]
};

type Data = {
    [key: string]: Field
};

export interface FormControl {
    data: Data
    addField: (name: string, validators: FieldValidator[], defaultValue: any, element?: FormElement) => void
    removeField: (name: string) => void
    touch: (name: string) => void
    isFieldDirty: (name: string) => boolean
    setField: (name: string, value: any, updateElementValue?: boolean) => void
    addError: (name: string, error: string, focus?: boolean) => void
    setFieldRef: (name: string, ref: FormElement) => void
    validate: (name: string) => void
    clearErrors: (name: string) => void
}

export function required(message: string) {
    return async (value: any) => {
        if (typeof value != "number" && !value) return message;
        if (value?.length == 0) return message;
    }
}

function analyzeNamePath(name: string): NamePathPart[] {
    return name.split(".").map(part => ({ value: part, arrayIndex: !isNaN(Number(part)) }));
}

// TODO: simplify this?
function createObjectFromPath(object: any, path: NamePathPart[], value: any) {
    let last = object;

    for (let i = 0; i < path.length; i++) {
        const part = path[i];

        if (!last.hasOwnProperty(part.value)) {
            if (path[i + 1]?.arrayIndex) {
                last[part.value] = [];
            } else {
                last[part.value] = {};
            }
        }

        if (i != path.length - 1) {
            last = last[part.value];
            continue;
        }

        last[part.value] = value;
    }

}

function createKeyValueFromObject<T>(object: any, setKey: (name: string, value: unknown) => void, path = "") {
    for (const key in object) {
        const value = object[key];

        if (typeof value == "undefined" || value == null) continue;

        if (typeof value === "object" || Array.isArray(value)) {
            createKeyValueFromObject(value, setKey, path + key + ".");
            continue;
        }

        const name = path + key;

        setKey(name, value);
    }
}

export function createArrayController<T>(name: string, control: FormControl, validators: FieldValidator[] = []) {
    const { errors, invalid, value, change } = createController<T[]>(name, control, validators, []);

    function add(item: T) {
        change([...value(), item]);
    }

    function remove(index: number) {
        // Je filter dobré řešení? Není to pomalější jak nějaká jiná alternativa?
        change(value().filter((_, i) => i != index));
    }

    function set(index: number, newItem: T) {
        change(value().map((item, i) => i == index ? newItem : item));
    }

    function swap(a: number, b: number) {
        // TODO: Tohle se dá určitě řešit lepším způsobem.
        let newArray = value().concat();
        newArray[a] = value()[b];
        newArray[b] = value()[a];
        change(newArray);
    }

    return { errors, invalid, items: value, add, set, remove, swap };
}

export function createController<T = any>(name: string, control: FormControl, validators: FieldValidator[] = [], defaultValue: any = "") {
    const { data, addField, removeField, isFieldDirty, addError, setField, setFieldRef, touch, validate, clearErrors } = control;

    function change(newValue: T, validateOnChange: boolean = true, updateRefValue: boolean = true) {
        setField(name, newValue, updateRefValue);

        if (validateOnChange) {
            validate(name);
        }
    }

    function focus() {
        touch(name);
    }

    function blur() {
        validate(name);
    }

    function trigger() {
        validate(name);
    }

    function clearErrorsLocal() {
        clearErrors(name);
    }

    function ref(el: FormElement) {
        setFieldRef(name, el);
    }

    function addErrorLocal(error: string, focus: boolean = false) {
        addError(name, error, focus);
    }

    onMount(() => {
        addField(name, validators, defaultValue);
        // onCleanup(() => removeField(name))
    });

    const value = createMemo(() => data[name]?.value ?? "") as Accessor<T>;
    const errors = createMemo(() => data[name]?.errors ?? []);
    const touched = createMemo(() => data[name]?.touched ?? false);
    const dirty = createMemo(() => isFieldDirty(name));
    const invalid = createMemo(() => errors().length > 0);

    return { value, ref, touched, dirty, errors, change, focus, blur, invalid, trigger, addError: addErrorLocal, clearErrors: clearErrorsLocal };
}

export function createForm<T extends { [name: string]: any }>() {
    // TODO: nebylo by lepší na tohle využít Map?
    const [initialData, setInitialData] = createStore<{ [name: string]: any }>();
    const [data, setData] = createStore<Data>();

    function isFormValid(): boolean {
        for (const key in data) {
            const field = data[key];

            if (field.errors.length > 0 || field.validators.length > 0 && !field.touched) {
                return false;
            }
        }

        return true;
    }

    function isFieldDirty(name: string): boolean {
        if (!data.hasOwnProperty(name)) {
            return false;
        }

        const value = data[name].value;

        if (!initialData.hasOwnProperty(name)) {
            return value != "";
        }

        return stableHash(initialData[name]) !== stableHash(value);
    }

    const dirty = createMemo<{ [name: string]: boolean }>(() => {
        let dirtyFields: { [name: string]: boolean } = {};

        for (const key in data) {
            dirtyFields[key] = isFieldDirty(key);
        }

        return dirtyFields;
    });

    const isDirty = createMemo(() => {
        for (const value of Object.values(dirty())) {
            if (value) {
                return true;
            }
        }

        return false;
    });

    // TODO: Performance?
    function extractFieldsMember(memberKey: "value" | "touched" | "errors"): { [key in keyof T]: any } {
        let object: any = {};

        for (const key in data) {
            createObjectFromPath(object, data[key].path, data[key][memberKey])
        }

        return object;
    }

    const values = createMemo<any>(() => extractFieldsMember("value") as any);
    const touched = createMemo<any>(() => extractFieldsMember("touched"));
    const errors = createMemo<any>(() => extractFieldsMember("errors"));
    const isValid = createMemo(() => isFormValid());

    function clearErrors(name?: string | string[]) {
        if (!name || Array.isArray(name) && name.length == 0) {
            for (const key in data) {
                setData(key, "errors", []);
            }
            return;
        }

        if (Array.isArray(name)) {
            for (const key of name) {
                setData(key, "errors", []);
            }
            return;
        }

        setData(name, "errors", []);
    }

    async function validate(name?: string | string[], focusOnError: boolean = false): Promise<boolean> {

        async function multiple(names: string[], focusOnError: boolean): Promise<boolean> {
            let isValid = true;
            let alreadyFocusField = false;

            for (const key of names) {
                const result = await validate(key, false);

                if (!result && isValid) {
                    isValid = false;

                    if (!alreadyFocusField && data[key].ref && focusOnError) {
                        data[key].ref!.focus();
                        alreadyFocusField = true;
                    }

                }
            }

            return isValid;
        }

        if (!name || name.length == 0) {
            return await multiple(Object.keys(data), focusOnError);
        }

        if (Array.isArray(name)) {
            return await multiple(name, focusOnError);
        }

        if (!data.hasOwnProperty(name)) return false;

        const validators = data[name].validators;

        let errors: string[] = [];

        for (const validator of validators) {
            const error = await validator(data[name].value, values());
            if (error === undefined) continue;
            errors.push(error);
        }

        if (errors.length > 0 && focusOnError) {
            data[name].ref?.focus();
        }

        setData(name, "errors", errors);
        return errors.length == 0;
    }

    function fieldRegister(name: string, validators: FieldValidator[] = []) {
        function onInput(e: any) {
            const target = e.target as FormElement;
            setField(name, target.type == "checkbox" ? e.target.checked : e.target.value, false);
            validate(name);
        }

        function onFocus(e: any) {
            touch(name);
        }

        function onBlur(e: any) {
            validate(name);
        }

        function ref(element: FormElement) {
            addField(name, validators, "", element);
            onCleanup(() => removeField(name));
        }

        return { onInput, onFocus, onBlur, name, ref };
    }

    function touch(name: string) {
        if (!data.hasOwnProperty(name)) return;
        setData(name, "touched", true);
    }

    function setFieldRef(name: string, ref: FormElement) {
        if (!data.hasOwnProperty(name)) return;
        setData(name, "ref", ref);
    }

    function addError(name: string, error: string, focus: boolean = false) {
        if (!data.hasOwnProperty(name)) return;
        setData(name, "errors", (errors) => [...errors, error]);

        if (focus && data[name].ref) {
            data[name].ref?.focus();
        }
    }

    function setField(name: string, value: any, updateElementValue: boolean = true) {
        if (!data.hasOwnProperty(name)) return;

        batch(() => {
            setData(name, "value", value);
            setData(name, "touched", true);
        });

        if (updateElementValue && data[name].ref) {
            data[name].ref!.value = value as any;
        }
    }

    function addField(name: string, validators: FieldValidator[], defaultValue: any, element?: FormElement) {
        const path = analyzeNamePath(name as string);

        let value = defaultValue;

        if (typeof data[name] != "undefined") {
            value = data[name].value

            if (element) {
                element.value = data[name].value;
            }
        }

        setData(name, { ref: element, errors: [], value, touched: false, validators, path })
    }

    function setValues(values: Partial<T>) {
        createKeyValueFromObject(values, (name, value) => {
            const alreadyExistingField: Field = unwrap(data)[name];
            if (alreadyExistingField != undefined) {
                setData(name, "value", value);
                return;
            }

            setData(name, {
                value,
                errors: [],
                path: analyzeNamePath(name),
                touched: false,
                validators: [],
            });
        });
    }

    function setInitialValues(values: Partial<T>) {
        const initialDirty = isDirty();

        createKeyValueFromObject(values, (name, value) => {
            setInitialData(name, value);
        });

        if (initialDirty) return;
        setValues(values);
    }

    function removeField(name: string) {
        // TODO: není tohle blbost?
        setData(data => {
            const { [name]: _, ...newData } = data;
            return newData;
        });
    }

    function handleSubmit(callback: (data: T) => void) {
        return async (event: SubmitEvent) => {
            event.preventDefault();

            if (!await validate(undefined, true)) return;

            callback(extractFieldsMember("value"));
        }
    }

    function reset() {
        if (Object.keys(initialData).length > 0) {
            for (const key in initialData) {
                setData(key, "value", initialData[key]);
            }
            validate();
            return;
        }

        for (const key in data) {
            setData(key, "value", "");
        }
        clearErrors();
    }

    const control = { data, addField, isFieldDirty, removeField, touch, validate, clearErrors, addError, setField, setFieldRef } as FormControl;

    return { reset, handleSubmit, control, field: fieldRegister, addError, setValues, setInitialValues, setField, trigger: validate, clearErrors, values, isValid, isDirty, touched, dirty, errors };
}