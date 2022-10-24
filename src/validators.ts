export function required(message: string) {
    return async (value: any) => {
        if (typeof value != "number" && !value) return message;
        if (value?.length == 0) return message;
    }
}