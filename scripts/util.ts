import { execSync } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Storage, File } from '@google-cloud/storage';
import request = require('request');
import { printConsoleStatus } from 'print-console-status';
import { uploadFileToSpace, doSpaceTransfer, cleanSpace } from './digital-ocean-transfer';
export { printConsoleStatus } from 'print-console-status';
process.env.GOOGLE_APPLICATION_CREDENTIALS = './dev-assets/cloud-storage-key.json';

function getCurrentBranch(): branches {
    const gitBranch = execSync('git branch').toString() as branches;
    return (
        gitBranch.includes('* master-all') ? 'master-all' :
            gitBranch.includes('* master') ? 'master' : null
    );
}

// export type buckets = 'quark-release' | 'quark-builds';
export type branches = 'master' | 'master-all';
export type storageUrl = 'https://quark-release.quarkjs.io' | 'https://quark-builds.quarkjs.io';
export type bucketName = 'quark-release.quarkjs.io' | 'quark-builds.quarkjs.io' | 'quark-build-assets';

export const currentBranch: branches = process.env.APPVEYOR_REPO_BRANCH || process.env.TRAVIS_BRANCH || process.env['BUILD_SOURCEBRANCHNAME'] || getCurrentBranch() as any;
export const isProductionBranch: boolean = currentBranch == 'master-all';
export const gitFilePath = './git-commit.txt';
export const wwwOutPath = './buildResources/www.tar.gz';


export function getFilesToUpload(version: number, type: typeof process.platform) {
    if (type == 'win32') {
        return [
            `./build/Quark-win-${version}.exe`,
            `./build/Quark-win-${version}.exe.blockmap`,
            `./build/Quark-win-x64-${version}.zip`,
            `./build/Quark-win-x64-${version}.msi`,
            './build/latest.yml'
        ];
    }

    if (type == 'linux') {
        return [
            `./build/Quark-linux-amd64-${version}.deb`,
            `./build/Quark-linux-x64-${version}.tar.gz`,
            `./build/Quark-linux-x86_64-${version}.AppImage`,
            `./build/latest-linux.yml`
        ];
    }

    if (type == 'darwin') {
        return [
            `./build/Quark-mac-${version}.dmg`,
            `./build/Quark-mac-${version}.dmg.blockmap`,
            `./build/Quark-mac-${version}.zip`,
            // `./build/Quark-mac-${version}.pkg`,
            // `./build/in.nishkal.plist`,
            `./build/latest-mac.yml`
        ];
    }
}

export const storage = new Storage({
    projectId: 'diy-mechatronics'
});

export function uploadFilesToBucket(bucketName: bucketName, version: number | string, paths: string[], allowFailFiles: boolean) {

    paths.map((_path) => {
        if (fs.existsSync(_path)) {
            const fileName = `Quark-${version}/${path.basename(_path)}`;
            const file = storage.bucket(bucketName).file(fileName);

            uploadFileToSpace(_path, fileName);

            fs.createReadStream(_path)
                .pipe(file.createWriteStream())
                .on('error', function (err) {
                    if (err) {
                        console.error(err);
                        printConsoleStatus(`Error uploading: ${_path}`, 'danger');
                    }
                })
                .on('finish', function () {
                    setTimeout(() => {
                        file.makePublic();
                    }, 1000);
                    printConsoleStatus(`Finished file: ${_path}`, 'success');
                });
            return;
        }


        printConsoleStatus(`File not found: ${_path}; Allow faliure: ${allowFailFiles};`, 'danger');
        if (!allowFailFiles) {
            throw Error(`File not found: ${_path}`);
        }
    });
}

export async function cleanDirectory(bucketName: string, dirName: string, ignores: RegExp) {
    printConsoleStatus(`Removing contents from bucket: ${bucketName}/${dirName}`, 'info');

    cleanSpace(dirName, ignores);

    const folders = await storage.bucket(bucketName).getFiles();
    const filesToDelete: Promise<[request.Response]>[] = [];
    folders.filter((folder) => {
        folder.map((file) => {
            if (file.name.startsWith(dirName)) {

                const canDeleteFile = !file.name.match(ignores);
                if (canDeleteFile) {
                    filesToDelete.push(file.delete());
                }
            }
        });
    });
    await Promise.all(filesToDelete);
    printConsoleStatus(`Removed ${filesToDelete.length} files from bucket: ${bucketName}/${dirName}`, 'success');

}

export async function doBucketTransfer(copyFromBucket: bucketName, copyToBucket: bucketName, folderFrom: string, folderTo: string, makePublic: boolean) {
    printConsoleStatus(`Transferring contents from bucket: ${copyFromBucket}/${folderFrom} to ${copyToBucket}/${folderTo};`, 'info');

    doSpaceTransfer(folderFrom, folderTo);

    const folders = await storage.bucket(copyFromBucket).getFiles();
    const destBucket = storage.bucket(copyToBucket);
    const filesToCopy: Promise<[File, request.Response]>[] = [];

    folders.filter((folder) => {
        folder.map((file) => {
            if (file.name.startsWith(folderFrom)) {
                const destFileName = path.posix.join(folderTo, path.basename(file.name));
                filesToCopy.push(file.copy(destBucket.file(destFileName)));
            }
        });
    });

    const copiedFiles = await Promise.all(filesToCopy);
    if (makePublic) {
        const publicPromiseAll = copiedFiles.map(async (file) => {
            await file[0].makePublic();
            if (file[0].name.match(/\.(yml|json|txt|md)$/)) {
                console.log(`File name: ${file[0].name} matched for no cache control.`);
                const meta = {
                    cacheControl: 'no-store',//this is the main one
                    'Cache-Control': 'no-store',
                    // metadata: {}
                }
                await file[0].setMetadata(meta);
            }
        });
        await Promise.all(publicPromiseAll);
    }

    printConsoleStatus(`Transferred : ${filesToCopy.length} files`, 'success');
    printConsoleStatus(`Transferred contents from bucket: ${copyFromBucket}/${folderFrom} to ${copyToBucket}/${folderTo};`, 'success');
}

export async function folderAlreadyExists(bucketName: bucketName, folder: string) {
    const folders = await storage.bucket(bucketName).getFiles();
    const arr: string[] = [];
    folders.map((folder) => {
        folder.map((file) => {
            arr.push(file.name);
        });
    });

    const result = arr.some((fileName) => {
        return fileName.includes(folder);
    });

    printConsoleStatus(`Folder already exists?: ${result}`, 'info');
    return result;
}

export async function copyContentsToRoot(bucketName: bucketName, folderName: string) {
    printConsoleStatus(`Copying contents to root: ${bucketName} from ${folderName};`, 'info');
    return new Promise(async (resolve) => {
        const currentVersionFiles: File[] = [];
        const filesToDelete: File[] = [];
        storage.bucket(bucketName).getFiles().then(async (folders) => {
            folders.map((folder) => {
                folder.map((file) => {

                    if (!file.name.includes('/') && !file.name.toLocaleLowerCase().match(/(appimage|blockmap)/)) {
                        filesToDelete.push(file);
                    }

                    if (!file.name.includes(`${folderName}/`)) {
                        return;
                    }

                    currentVersionFiles.push(file);
                });
            });

            const promises: Promise<any>[] = currentVersionFiles.map(async (file) => {
                console.log(`Copying: ${file.name} to ${file.name.replace(`${folderName}/`, '')}`);
                const copy = await file.copy(file.name.replace(`${folderName}/`, ''));
                return copy[0].makePublic();
            });

            promises.concat(filesToDelete.map((file) => {
                console.log(`Deleting: ${file.name}`);
                return file.delete();
            }));

            await Promise.all(promises);
            resolve(true);
        }).catch((err) => {
            console.log(err);
            resolve(false);
        });
        printConsoleStatus(`Copied contents to root: ${bucketName} from ${folderName};`, 'success');
    });
}

export async function fetchFolderContents(bucketName: bucketName, folderName: string) {
    const arr: File[] = [];
    (await storage.bucket(bucketName).getFiles()).map((files) => {
        files.map((file) => {
            if (file.name.includes(`${folderName}/`)) {
                arr.push(file);
            }
        })
    });
    return arr;
}