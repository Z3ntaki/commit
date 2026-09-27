const axios = require('axios');
axios.get('https://ghchart.rshah.org/torvalds').then(res => {
  console.log(res.data.substring(0, 1000));
});
