// Подменяет импорты 'sdk' и 'sdk/db' на локальные заглушки.
export async function resolve(specifier, context, next) {
  if (specifier === 'sdk' || specifier === 'sdk/api' || specifier === 'sdk/fetch') return { url: new URL('./sdk/index.js', import.meta.url).href, shortCircuit: true };
  if (specifier === 'sdk/db') return { url: new URL('./sdk/db.js', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
