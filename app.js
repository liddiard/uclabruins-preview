#! /usr/bin/env node

const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');
const argv = require('yargs').argv;

const chokidar = require('chokidar');
const cheerio = require('cheerio');
const request = require('superagent');

const DEFAULT_TEMPLATE = "http://www.uclabruins.com/sports/2015/10/21/210437289.aspx";
const DEFAULT_PORT = 3001;

const templateUrl = argv.template || DEFAULT_TEMPLATE;
const port = argv.port || DEFAULT_PORT;
const pageFile = argv._[0];

let server;
let template;
let page;

if (!pageFile) {
  console.error('ERROR: No page specified to preview.');
  process.exit(1);
}

function getTemplate() {
  // get the base page template from a remote server
  console.log('getting template...');
  var str = "";
  http.get(templateUrl, function(res){
    res.on('data', function(chunk){
      str += chunk;
    });
    res.on('end', function(){
      $ = cheerio.load(str); // load page template into a global Cheerio object
      template = formatTemplate(str);
      readPage();
    });
  });
}

function formatTemplate(html) {
  // remove the <base> tag which tells all relative links to be relative
  // to uclabruins.com
  $('base').remove();
  // replace relative links in the template with absolute links
  // this is necessary because otherwise, relative links would point to
  // localhost, breaking most static assets
  var relativeRegex = /^\/(?!\/)\S+$/; // regex which detects relative links
  var parsedUrl = url.parse(templateUrl);
  var websiteBase = parsedUrl.protocol + "//" + parsedUrl.host;
  $('[href]').each(function(){
    var href = $(this).attr('href');
    if (relativeRegex.test(href)) {
      href = websiteBase + href;
      $(this).attr('href', href);
    }
  });
  $('[src]').each(function(){
    var src = $(this).attr('src');
    if (relativeRegex.test(src)) {
      src = websiteBase + src;
      $(this).attr('src', src);
    }
  });
  return $.html();
}

function readPage() {
  // read the local page to inject into the template from the filesystem
  console.log('reading page...');
  fs.readFile(pageFile, function(err, data){
    if (err) {
      console.error(err);
      process.exit(1);
    }
    page = formatPage(data.toString());
    replaceArticle();
  });
}

function formatPage(page) {
  // replace {{STATIC_URL}} variables with relative root ('/')
  const staticUrlRegex = /{{STATIC_URL}}/g;
  return page.replace(staticUrlRegex, '/');
}

function replaceArticle() {
  // replace the article content of the template with the content of the local
  // HTML page
  console.log('replacing article...');
  $('#article-content').empty();
  $('#article-content').append(page);
  servePreview($.html());
}

function servePreview(html) {
  // start the preview server locally
  console.log('serving preview of ' + pageFile + ' at http://localhost:' + port);
  server = http.createServer(function(req, res){
    const uri = url.parse(req.url).pathname;
    const filename = path.join(process.cwd(), uri);
    if (uri === '/') {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(html);
    }
    else {
      fs.exists(filename, function(exists) {
        if (!exists) {
          res.writeHead(404, {"Content-Type": "text/plain"});
          res.write("404 Not Found\n");
          res.end();
        }
        else {
          fs.readFile(filename, "binary", function(err, file) {
            if (err) {
              res.writeHead(500, {"Content-Type": "text/plain"});
              res.write(err + "\n");
              res.end();
            }

            res.writeHead(200);
            res.write(file, "binary");
            res.end();
          });
        }
      });
    }
     // don't allow client to keep the connection open which prevents server
     // from restarting
    //req.connection.destroy();
  }).listen(port, 'localhost');
}

getTemplate(); // generate template initially

chokidar.watch(pageFile).on('change', function(){
  // listen for changes to the page file. if it changes, stop and restart the server.
  var date = new Date();
  var formattedTime = [date.getHours(), date.getMinutes(), date.getSeconds()].join(':');
  console.log('[' + formattedTime + '] ' + 'detected change, reloading...');
  server.close(readPage); // invoke readPage as a callback once server is closed
});
