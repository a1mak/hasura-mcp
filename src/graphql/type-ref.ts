/** A type reference as introspection returns it: wrappers around one named type. */
export type TypeRef = {
  readonly kind: string;
  readonly name: string | null;
  readonly ofType?: TypeRef | null;
};

/** The literal string an agent writes in a variable declaration: `uuid!`, `[String!]`. */
export const renderType = (ref: TypeRef | null | undefined): string | null => {
  if (!ref) return null;

  if (ref.kind === 'NON_NULL') {
    const inner = renderType(ref.ofType);
    return inner === null ? null : `${inner}!`;
  }
  if (ref.kind === 'LIST') {
    const inner = renderType(ref.ofType);
    return inner === null ? null : `[${inner}]`;
  }
  return ref.name;
};

/** The named type at the centre of the wrappers, which is what identifies a table. */
export const namedType = (ref: TypeRef | null | undefined): string | null => {
  let current: TypeRef | null | undefined = ref;
  while (current?.ofType) current = current.ofType;
  return current?.name ?? null;
};

/**
 * Optionality lives in the outermost wrapper alone. `[String!]` is an optional
 * list of required elements, which a single boolean cannot express — hence
 * `renderType` is reported alongside this.
 */
export const isNullable = (ref: TypeRef | null | undefined): boolean => {
  if (!ref) return true;
  return ref.kind !== 'NON_NULL';
};
