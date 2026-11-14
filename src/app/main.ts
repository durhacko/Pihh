const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing app root');
if (import.meta.env.VITE_SIM_MODE === 'false') {
  throw new Error('Encore supports simulation mode only');
}
app.innerHTML = '<h1>Encore</h1><p>Simulation scaffold ready. Drone simulation is not implemented yet.</p>';
