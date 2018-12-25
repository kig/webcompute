#!/bin/bash

HOSTS=$(cat `dirname $BASH_SOURCE`/../etc/push_hosts)

for f in $HOSTS
do 
  git push $f:code/node-ispc master-remote:master-remote
  ssh $f 'cd code/node-ispc; git merge master-remote'
done

