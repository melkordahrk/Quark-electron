import { Storage } from '@google-cloud/storage';
import * as fs from 'fs-extra';
import { printConsoleStatus } from './util';
import console = require('console');

process.env.GOOGLE_APPLICATION_CREDENTIALS = './dev-assets/cloud-storage-key.json';
const bucketName = 'quarkjs-auto-update';
const json = JSON.parse(fs.readFileSync('./package.json').toString());
const version = json.version;

const storage = new Storage({
    projectId: 'diy-mechatronics'
});

const paths = [
    `./build/Quark-win-${version}.exe`,
    `./build/Quark-win-${version}.exe.blockmap`,
    `./build/Quark-win-x64-${version}.zip`,
    './build/latest.yml',

    `./build/Quark-linux-amd64-${version}.deb`,
    `./build/Quark-linux-x64-${version}.tar.gz`,
    `./build/Quark-linux-x86_64-${version}.AppImage`,
    `./build/latest-linux.yml`,
]

paths.map((_path) => {
    if (fs.existsSync(_path)) {
        printConsoleStatus(`Found file: ${_path}`, 'info');
        const file = storage.bucket(bucketName).file(`Quark-${json.version}-test/${_path}`);
        printConsoleStatus(`Uploading: ${_path}`, 'info');
        fs.createReadStream(_path)
            .pipe(file.createWriteStream())
            .on('error', function (err) {
                if (err) {
                    console.error(err);
                    printConsoleStatus(`Error uploading: ${_path}`, 'danger');
                }
            })
            .on('finish', function () {
                printConsoleStatus(`Finished file: ${_path}`, 'danger');
            });
        return;
    }

    printConsoleStatus(`File not found: ${_path}`, 'danger');
});

