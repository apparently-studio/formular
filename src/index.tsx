import { Accessor, createMemo, onCleanup, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";

export type FieldValidator = (value: any, values: any) => Promise<string | void>

type FormElement = HTMLInputElement | HTMLSelectElement;

interface NamePathPart {
    value: string | number
    arrayIndex: boolean
}

type Data = {
    [key: string]: {
        path: NamePathPart[]
        ref?: FormElement
        value: any
        touched: boolean
        errors: string[]
        validators: FieldValidator[]
    }
};

export interface FormControl {
    data: Data
    addField: (name: string, validators: FieldValidator[], defaultValue: any, element?: FormElement) => void
    removeField: (name: string) => void
    touch: (name: string) => void
    setField: (name: string, value: any) => void
    addError: (name: string, error: string, focus?: boolean) => void
    setFieldRef: (name: string, ref: FormElement) => void
    validate: (name: string) => void
    clearErrors: (name: string) => void
}

function analyzeNamePath(name: string): NamePathPart[] {
    let namePath: NamePathPart[] = [];

    for (const part of name.split(".")) {
        namePath.push({
            value: part,
            arrayIndex: !isNaN(Number(part))
        });
    }

    return namePath;
}

export function createController<T = any>(name: string, control: FormControl, validators: FieldValidator[] = [], defaultValue: any = "") {
    const { data, addField, removeField, addError, setField, setFieldRef, touch, validate, clearErrors } = control;

    function change(newValue: T, validateOnChange: boolean = true) {
        setField(name, newValue);

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
        onCleanup(() => removeField(name))
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

export function createForm<T extends { [name: string]: any }>(initialValues?: Partial<T>) {
    const [data, setData] = createStore<Data>({} as any);

    function isFormValid(): boolean {
        for (const key in data) {
            const field = data[key];

            if (field.errors.length > 0 || field.validators.length > 0 && !field.touched) {
                return false;
            }
        }

        return true;
    }

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

    // TODO: Performance?
    function extractFieldsMember(memberKey: "value" | "touched" | "errors"): { [key in keyof T]: any } {
        let object: any = {};

        for (const key in data) {
            createObjectFromPath(object, data[key].path, data[key][memberKey])
        }

        return object;
    }

    const values = createMemo<T>(() => extractFieldsMember("value") as any);
    const touched = createMemo<any>(() => extractFieldsMember("touched"));
    const errors = createMemo<any>(() => extractFieldsMember("errors"));
    const isValid = createMemo(() => isFormValid());

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

    function setField(name: string, value: string, updateElementValue: boolean = true) {
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
        setData(produce(data => {
            let value: string = element?.value ?? defaultValue;

            if (element?.type == "checkbox") {
                value = (element as any).checked;
            }

            if (initialValues?.[name] !== undefined) {
                value = initialValues[name]! as any;

                if (element) {
                    element.value = value;
                }
            }

            data[name] = { ref: element, errors: [], value, touched: false, validators, path: analyzeNamePath(name as string) };
        }));
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

    const control = { data, addField, removeField, touch, validate, clearErrors, addError, setField, setFieldRef } as FormControl;

    return { handleSubmit, control, field: fieldRegister, addError, setField, trigger: validate, clearErrors, values, isValid, touched, errors };
}