const https = require('https');

const modelsToCheck = [
  'openrouter/free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'google/gemma-3-4b-it:free',
  'google/gemma-3-12b-it:free',
  'google/gemma-3-27b-it:free'
];

console.log('Fetching model capabilities from OpenRouter...');

https.get('https://openrouter.ai/api/v1/models', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      const allModels = response.data || [];
      
      console.log('\n--- All Free Vision Models ---');
      const freeModels = allModels.filter(m => m.id.endsWith(':free') || m.pricing?.prompt === '0');
      const freeVisionModels = freeModels.filter(m => {
        const inputs = m.architecture?.input_modalities || [];
        return inputs.includes('image');
      });

      freeVisionModels.forEach(m => {
        const params = m.supported_parameters || [];
        const hasReasoning = params.includes('reasoning') || params.includes('include_reasoning') || (m.description && m.description.toLowerCase().includes('reasoning'));
        console.log(`ID: ${m.id}`);
        console.log(`  Name: ${m.name}`);
        console.log(`  Reasoning: ${hasReasoning}`);
        console.log(`  Context: ${m.context_length}`);
        console.log('---');
      });

      
    } catch (e) {
      console.error('Error parsing response:', e.message);
    }
  });
}).on('error', (e) => {
  console.error('Error fetching models:', e.message);
});
