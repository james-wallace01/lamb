// Launcher to ensure backend runs with backend/ as the working directory.
process.chdir(__dirname);
require('./server');
