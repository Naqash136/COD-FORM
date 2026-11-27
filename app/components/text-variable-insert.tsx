import { VARIABLE_MENU } from "../bundles/text";

export function TextVariableInsert({
  field,
  onInsert,
}: {
  field: string;
  onInsert: (token: string) => void;
}) {
  const menuId = `variables-${field}`;
  return (
    <>
      <s-button variant="tertiary" icon="text-with-image" commandFor={menuId}>
        Insert variable
      </s-button>
      <s-menu id={menuId} accessibilityLabel={`Insert a variable into ${field}`}>
        {VARIABLE_MENU.map((item) => (
          <s-button key={item.token} variant="tertiary" commandFor={menuId} command="--hide" onClick={() => onInsert(`{{${item.token}}}`)}>
            {item.label}
          </s-button>
        ))}
      </s-menu>
    </>
  );
}
