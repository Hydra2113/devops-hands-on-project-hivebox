import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', setInterval: 'readonly', AbortSignal: 'readonly' },
        },
    },
];
