import { env, pipeline } from '@huggingface/transformers';
import { MODEL_CONFIGS } from '../src/conversation-config.ts';
import { buildConversation } from '../src/ai-context.ts';
import { runAgent } from '../src/browser-agent.ts';
import { constrainedRestaurantQuery, recommendPlaces } from '../src/recommendations.ts';
env.cacheDir = './.ai-smoke-cache'; env.allowLocalModels = false;
const config = MODEL_CONFIGS[process.argv.includes('--compact') ? 'compact' : 'standard'];
const model = await pipeline('text-generation', config.id, { revision: config.revision, dtype: 'q4', device: 'cpu' });
const generate = async messages => (await model(messages, { max_new_tokens: 100, do_sample: false, repetition_penalty: 1.1 }))[0].generated_text.at(-1).content;
const turns = [];
for (const question of ['Hi, my name is Alex.', 'What is my name?']) {
  turns.push({ role: 'user', text: question });
  let hiddenPlans=0;
  await runAgent({turns,records:[],signal:new AbortController().signal,compact:process.argv.includes('--compact'),plan:async()=>{hiddenPlans++;return '<tool_call>[]</tool_call>'},execute:async()=>{throw new Error('Ordinary chat must not execute tools')}});
  if(hiddenPlans)throw new Error('Ordinary conversation invoked hidden planning.');
  const reply = await generate(buildConversation(turns, '[]'));
  console.log(JSON.stringify({ question, reply })); turns.push({ role: 'assistant', text: reply });
  if (question === 'What is my name?' && !/Alex/i.test(reply)) throw new Error('Conversation memory smoke check failed.');
}
const records = [{ id: 'one', name: 'Test Kitchen', cuisine: 'italian', distanceMetres: 100 }, ...Array.from({ length: 19 }, (_, index) => ({ id: 'osm:node/' + (100 + index), name: 'Cafe ' + index, cuisine: 'cafe', distanceMetres: 150 + index * 20 }))];
for (const [question, expected] of [['Find Italian restaurants nearby.', ['search_restaurants','recommend_restaurants']], ['Recommend a new place I have not visited.', 'recommend_restaurants'], ['Give me directions to Test Kitchen.', 'get_directions'], ['What can I eat for lunch at Test Kitchen?', ['read_menu','list_items']], ['Take me to the Test Kitchen restaurant card.', 'open_restaurant']]) {
  const actions=[];
  const places=records.map(record=>({id:record.id,name:record.name,tags:{cuisine:record.cuisine},lat:60,lon:24,distance:record.distanceMetres}));
  const results=await runAgent({ compact:process.argv.includes('--compact'), turns:[{role:'user',text:question}], records, selectedId:question.includes('Test Kitchen')?'one':undefined, signal:new AbortController().signal, plan:generate, execute:async action=> { actions.push(action); return ['search_restaurants','recommend_restaurants'].includes(action.tool)?recommendPlaces(places,[],{likes:[],dislikes:[],learn:true},constrainedRestaurantQuery(action.query,question,places),action.tool==='recommend_restaurants'?action.unvisited:false).map(choice=>({id:choice.place.id,name:choice.place.name})):['read_menu','list_items'].includes(action.tool)?{restaurant:'Test Kitchen',entries:[{name:'Vegan curry',price:'12€'}]}:{restaurant:'Test Kitchen',id:'one'}; } });
  console.log(JSON.stringify({question,actions,results}));
  if (!actions.some(action=>(Array.isArray(expected)?expected:[expected]).includes(action.tool))) throw new Error('Agent did not use '+expected);
}
await model.dispose();
