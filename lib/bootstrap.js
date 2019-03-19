import httpLoader from '../blueprints/loaders/http'

const Load = function(file) {
  httpLoader.module.init()
  httpLoader.module.in.call(httpLoader.module, file, null, null, true)
}

if (window) {
  // Example use: <script src="web/frame.bootstrap.js" entry="index.js"></script>
  var script = document.querySelector('script[entry]');
  if (!script)
    Load('./index.js');
  else {
    var file = script.getAttribute('entry');
    Load('./' + file);
  }
}
