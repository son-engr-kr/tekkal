import type { TextElement as TextElementType, TextStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { TextContent } from "./TextContent";

interface Props {
  element: TextElementType;
}

export function TextElementRenderer({ element }: Props) {
  const style = useElementStyle<TextStyle>("text", element.style);
  return (
    <TextContent
      content={element.content}
      style={style}
      width={element.size.w}
      height={element.size.h}
    />
  );
}
