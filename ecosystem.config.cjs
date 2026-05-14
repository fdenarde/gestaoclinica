module.exports = {
  apps: [
    {
      name: 'ClinicaFrontend',
      script: 'start-frontend.cjs',
      cwd: './gestão-clínica-fábio-denarde'
    },
    {
      name: 'RoboClinica',
      script: 'server.js',
      cwd: './gestão-clínica-fábio-denarde'
    },
    {
      name: 'AutoDeployWatcher',
      script: 'watch-and-deploy.cjs',
      cwd: './'
    }
  ]
};
