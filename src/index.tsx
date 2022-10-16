import { Accessor, createEffect, createMemo, onCleanup, onMount, on } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";

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

type Values = {
    [key: string]: string
}

export interface FormControl {
    data: Data
    addField: (name: string, validators: FieldValidator[], defaultValue: any, element?: FormElement) => void
    removeField: (name: string) => void
    touch: (name: string) => void
    setField: (name: string, value: any, updateElementValue?: boolean) => void
    addError: (name: string, error: string, focus?: boolean) => void
    setFieldRef: (name: string, ref: FormElement) => void
    validate: (name: string) => void
    clearErrors: (name: string) => void
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
    const { data, addField, removeField, addError, setField, setFieldRef, touch, validate, clearErrors } = control;

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
    const invalid = createMemo(() => errors().length > 0);

    return { value, ref, touched, errors, change, focus, blur, invalid, trigger, addError: addErrorLocal, clearErrors: clearErrorsLocal };
}

export function required(message: string) {
    return async (value: any) => {
        if (typeof value != "number" && !value) return message;
        if (value?.length == 0) return message;
    }
}

export function createForm<T extends { [name: string]: any }>() {
    const [initialData, setInitialData] = createStore<Values>();
    const [data, setData] = createStore<Data>();

    function setDataFromObject(object: any, path = "", previousData: Data = {}): Data {

        for (const key in object) {
            const value = object[key];

            if (typeof value == "undefined" || value == null) continue;

            if (typeof value === "object" || Array.isArray(value)) {
                setDataFromObject(value, path + key + ".", previousData);
                continue;
            }

            const name = path + key;

            const alreadyExistingField: Field = unwrap(data)[name];
            if (alreadyExistingField != undefined) {
                previousData[name] = { ...alreadyExistingField, value };
                continue;
            }


            previousData[name] = {
                value,
                errors: [],
                path: analyzeNamePath(name),
                touched: false,
                validators: [],
            };
        }

        return previousData;
    }

    function isFormValid(): boolean {
        for (const key in data) {
            const field = data[key];

            if (field.errors.length > 0 || field.validators.length > 0 && !field.touched) {
                return false;
            }
        }

        return true;
    }

    function isFormDirty(): boolean {
        function setValuesFromObject(object: any, path = "", previousData: Values = {}): Values {

            for (const key in object) {
                const value = object[key];

                if (typeof value == "undefined" || value == null) continue;

                if (typeof value === "object" || Array.isArray(value)) {
                    setValuesFromObject(value, path + key + ".", previousData);
                    continue;
                }

                const name = path + key;
                previousData[name] = value;
            }

            return previousData;
        }

        const comparableData = setValuesFromObject(initialData);

        if (Object.keys(comparableData).length > 0) {
            for (const key in comparableData) {
                if (!data[key] || (data[key].value != comparableData[key])) return true;
            }
        } else {
            for (const key in data) {
                if (data[key].value != "") return true;
            }
        }

        return false;
    }

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
    const isDirty = createMemo(() => isFormDirty());

    function clearErrors(name?: string | string[]) {
        setData(produce(data => {
            if (!name || Array.isArray(name) && name.length == 0) {
                for (const key in data) {
                    data[key].errors = [];
                }
                return;
            }

            if (Array.isArray(name)) {
                for (const key of name) {
                    data[key].errors = [];
                }
                return;
            }

            data[name as string].errors = [];
        }))
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

        if (data[name] == undefined) return false;

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

        setData(produce(data => {
            data[name].errors = errors;
        }));

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
        if (data[name] === undefined) return;

        setData(produce(data => {
            data[name].touched = true;
        }));
    }

    function setFieldRef(name: string, ref: FormElement) {
        if (data[name] === undefined) return;

        setData(produce(data => {
            data[name].ref = ref;
        }));
    }

    function addError(name: string, error: string, focus: boolean = false) {
        if (data[name] === undefined) return;

        setData(produce(data => {
            data[name].errors.push(error);
        }));

        if (focus && data[name].ref) {
            data[name].ref?.focus();
        }
    }

    function setField(name: string, value: any, updateElementValue: boolean = true) {
        if (data[name] === undefined) return;

        setData(produce(data => {
            data[name].value = value;

            if (!data[name].touched) {
                data[name].touched = true;
            }
        }));

        if (updateElementValue && data[name].ref) {
            data[name].ref!.value = value as any;
        }
    }

    function addField(name: string, validators: FieldValidator[], defaultValue: any, element?: FormElement) {
        const path = analyzeNamePath(name as string);

        setData(produce(data => {
            let value = defaultValue;

            if (typeof data[name] != "undefined") {
                value = data[name].value

                if (element) {
                    element.value = data[name].value;
                }
            }

            data[name] = { ref: element, errors: [], value, touched: false, validators, path };
        }));
    }

    function setValues(values: Partial<T>) {
        setData(setDataFromObject(values));
    }

    function setInitialValues(values: Partial<T>) {
        const initialDirty = isDirty();
        setInitialData(values);
        if (initialDirty) return;
        setData(setDataFromObject(values));
    }

    function removeField(name: string) {
        setData(produce(data => {
            delete data[name];
        }));
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
            setData(setDataFromObject(initialData));
            validate();
            return;
        }

        for (const key in data) {
            setData(produce(data => {
                data[key].value = "";
            }));
        }
        clearErrors();
    }

    const control = { data, addField, removeField, touch, validate, clearErrors, addError, setField, setFieldRef } as FormControl;

    return { reset, handleSubmit, control, field: fieldRegister, addError, setValues, setInitialValues, setField, trigger: validate, clearErrors, values, isValid, isDirty, touched, errors };
}