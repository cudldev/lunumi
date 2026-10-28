import ChatAssistant from './ChatAssistant';
import type { Place } from './core';
export default function MenuAssistant({ place }: { place: Place }) {
  return <ChatAssistant places={[place]} initialPlace={place}/>;
}
