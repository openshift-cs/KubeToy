const express = require('express');
let app = express();
app.set('port', process.env.PORT || 8080);

let pod = process.env.HOSTNAME || 'unknown-pod';

app.get('/', function(request, response) {
  let randomColor = getRandomColor(); // <-- comment this
  // let randomColor = getRandomGrayScaleColor(); // <-- uncomment this

  response.writeHead(200, {'Content-Type': 'application/json'});
  response.end(JSON.stringify({
    'pod': pod,
    'color': randomColor
  }));

  console.log('Responding with ' + randomColor + ' for ' + pod);
});

function getRandomColor() {
  return '#000000'.replace(/0/g, function() {
    return (~~(Math.random() * 16)).toString(16);
  });
}

function getRandomGrayScaleColor() {
  let value = Math.random() * 0xFF | 0,
      grayscale = (value << 16) | (value << 8) | value;
  return '#' + grayscale.toString(16);
}

app.listen(app.get('port'), '0.0.0.0', function() {
  console.log(pod + ': microservice starting on port ' + app.get('port'));
});
